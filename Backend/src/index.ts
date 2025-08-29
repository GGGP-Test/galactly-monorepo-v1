import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { migrate, q } from './db';
import { nowPlusMinutes, toISO } from './util';
import { runIngest } from './ingest';

const app = express();
app.use(express.json({ limit: '200kb' }));

// CORS (GH Pages / anywhere)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/** small helpers */
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return ADMIN_TOKEN && t === ADMIN_TOKEN;
}
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

/** basics */
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));
app.get('/__routes', (_req, res) =>
  res.json([
    { path: '/healthz', methods: ['get'] },
    { path: '/__routes', methods: ['get'] },
    { path: '/whoami', methods: ['get'] },
    { path: '/api/v1/status', methods: ['get'] },
    { path: '/api/v1/leads', methods: ['get'] },
    { path: '/api/v1/claim', methods: ['post'] },
    { path: '/api/v1/own', methods: ['post'] },
    { path: '/api/v1/events', methods: ['post'] },
    { path: '/api/v1/admin/ingest', methods: ['post'] },
    { path: '/api/v1/admin/poll-now', methods: ['get'] },
    { path: '/api/v1/debug/peek', methods: ['get'] }
  ])
);

/** status */
app.get('/api/v1/status', (req, res) => {
  const userId = (req as any).userId || 'anon';
  const fp = userId.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 1000;
  res.json({ ok: true, fp, cooldownSec: 0, priority: 1 });
});

/** leads feed — NO brand join, matches minimal schema */
app.get('/api/v1/leads', async (req, res) => {
  try {
    const limit = 30;
    const r = await q<any>(
      `SELECT id, cat, kw, platform, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool
       WHERE state='available'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    let leads = r.rows;
    // keep UI from being totally empty while ingest warms up
    if (!leads.length) {
      leads = [
        {
          id: -1,
          cat: 'demo',
          kw: ['packaging'],
          platform: 'ad_surge',
          heat: 80,
          source_url: 'https://example.com/proof',
          title: 'Demo HOT lead (signals warming up)',
          snippet: 'This placeholder disappears once your signal ingestors run.',
          ttl: toISO(nowPlusMinutes(60)),
          state: 'available',
          created_at: new Date().toISOString()
        }
      ];
    }

    res.json({ ok: true, leads, nextRefreshSec: 20 });
  } catch (e: any) {
    res.status(503).json({ ok: false, error: String(e?.message || e) });
  }
});

/** claim / own */
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2);

  const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
                     WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(
    `INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
     VALUES ($1,$2,$3,$4)`,
    [windowId, leadId, userId, reservedUntil]
  );
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
           VALUES ($1,$2,'claim','{}')`, [userId, leadId]);

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<any>(
    `SELECT lead_id FROM claim_window
     WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
           VALUES ($1,$2,'own','{}')`, [userId, leadId]);

  res.json({ ok: true });
});

/** lightweight events */
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok: false, error: 'bad request' });
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
           VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta || {}]);
  res.json({ ok: true });
});

/** admin: ingest (POST) + poll-now (GET, same behavior) */
async function doIngest(source: string) {
  const s = (source || 'all').toLowerCase();
  const out = await runIngest(s);
  // normalize shape for your CLI scripts
  const did: string[] = [];
  if ((out as any).did === 'brandintake') did.push('brandintake');
  if ((out as any).did === 'derive_leads') did.push('derive_leads');
  return { ok: true, did, ...(out as any) };
}

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { source } = req.query as any;
  const out = await doIngest(String(source || 'all'));
  res.json(out);
});

app.get('/api/v1/admin/poll-now', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const { source } = req.query as any;
  const out = await doIngest(String(source || 'all'));
  res.json(out);
});

/** debug */
app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const a = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const t = await q(`SELECT COUNT(*) FROM lead_pool`);
    res.json({
      ok: true,
      counts: { leads_available: Number(a.rows[0].count || 0), leads_total: Number(t.rows[0].count || 0) },
      env: { BRANDS_FILE: !!process.env.BRANDS_FILE, BRANDS_FILE_PATH: process.env.BRANDS_FILE || null }
    });
  } catch (e: any) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

/** start */
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
