import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { migrate, q } from './db';
import { nowPlusMinutes, toISO } from './util';
import { runIngest as runBrandIntake } from './ingest';

const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS for GH Pages / anywhere
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || '';

function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return ADMIN_TOKEN && t === ADMIN_TOKEN;
}

// attach a soft user id from header
app.use((req, _res, next) => { (req as any).userId = req.header('x-galactly-user') || null; next(); });

// ---------------- basics/debug ----------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));

app.get('/__routes', (_req, res) => res.json([
  { path: '/healthz', methods: ['get'] },
  { path: '/__routes', methods: ['get'] },
  { path: '/whoami', methods: ['get'] },
  { path: '/api/v1/status', methods: ['get'] },
  { path: '/api/v1/gate', methods: ['post'] },
  { path: '/api/v1/leads', methods: ['get'] },
  { path: '/api/v1/claim', methods: ['post'] },
  { path: '/api/v1/own', methods: ['post'] },
  { path: '/api/v1/debug/peek', methods: ['get'] },
  { path: '/api/v1/admin/seed-brands', methods: ['post'] },
  { path: '/api/v1/admin/ingest', methods: ['post'] }
]));

// simple product status
app.get('/api/v1/status', (_req, res) => res.json({ ok: true, mode: 'vendor-signals' }));

// ---------------- users ----------------
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  const { region, email, alerts } = req.body || {};
  await q(`INSERT INTO app_user(id,region,email,alerts)
           VALUES ($1,$2,$3,COALESCE($4,false))
           ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email,
                                         alerts=EXCLUDED.alerts, updated_at=now()`,
    [userId, region || null, email || null, alerts === true]);
  res.json({ ok: true });
});

// ---------------- leads feed ----------------
app.get('/api/v1/leads', async (req, res) => {
  const userId = (req as any).userId || null;

  const r = await q<any>(`
    SELECT id, platform, source_url, title, snippet, heat, confidence, state, created_at
    FROM lead_pool
    WHERE state='available'
    ORDER BY created_at DESC
    LIMIT 30
  `);

  let leads = r.rows;
  if (userId && leads.length) {
    const vals = leads.map(L => `('${userId}', ${Number(L.id)}, 'impression', now(), '{}'::jsonb)`).join(',');
    await q(`INSERT INTO event_log (user_id, lead_id, event_type, created_at, meta)
             VALUES ${vals}`);
  }

  if (!leads.length) {
    leads = [{
      id: -1,
      platform: 'ad_surge',
      source_url: 'https://example.com/proof',
      title: 'Demo HOT lead (signals warming up)',
      snippet: 'This placeholder disappears once your signal ingestors run.',
      heat: 80,
      confidence: 0.75,
      state: 'available',
      created_at: new Date().toISOString()
    }];
  }

  res.json({ ok: true, leads, nextRefreshSec: 20 });
});

// ---------------- claim / own ----------------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2).toISOString();

  const r = await q(`UPDATE lead_pool
                     SET state='reserved', reserved_by=$1, reserved_at=now()
                     WHERE id=$2 AND state='available'
                     RETURNING id`, [userId, leadId]);
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
           VALUES($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
           VALUES ($1,$2,'claim','{}')`, [userId, leadId]);

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<any>(`SELECT lead_id
                          FROM claim_window
                          WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);

  res.json({ ok: true });
});

// ---------------- admin ----------------
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  // very lightweight: accept plain domains (one per line) as “brands”
  if (!BRANDS_FILE) return res.json({ ok: false, error: 'BRANDS_FILE missing' });
  res.json({ ok: true, note: 'seeding now happens via brandintake scanner; keep BRANDS_FILE mounted at suppliers list' });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const src = String((req.query.source as string) || 'all').toLowerCase();
  const out: any = { ok: true, did: [] as string[] };

  try {
    if (src === 'brandintake' || src === 'all') {
      console.log('[brandintake] start… file =', BRANDS_FILE || '(unset)');
      const r = await runBrandIntake('brandintake');
      out.did.push('brandintake');
      Object.assign(out, { brandintake: r });
    }

    if (src === 'signals' || src === 'all') {
      // placeholder: materializer (no-op if you’re not writing to signal table)
      out.did.push('derive_leads');
      Object.assign(out, { derive: { created: 0 } });
    }

    if (!out.did.length) return res.json({ ok: true, did: 'noop' });
    return res.json(out);
  } catch (e) {
    console.error('[admin/ingest] error', e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------------- debug peek ----------------
app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const l = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const total = await q(`SELECT COUNT(*) FROM lead_pool`);
    res.json({
      ok: true,
      counts: {
        leads_available: Number(l.rows[0]?.count || 0),
        leads_total: Number(total.rows[0]?.count || 0),
      },
      env: { BRANDS_FILE: !!BRANDS_FILE, BRANDS_FILE_PATH: BRANDS_FILE || null }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------------- start ----------------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[boot] galactly-api listening on :${PORT}`);
    console.log(`[boot] BRANDS_FILE = ${BRANDS_FILE || '(unset)'}`);
  });
});
