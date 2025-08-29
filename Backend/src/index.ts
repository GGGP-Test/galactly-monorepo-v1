import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { runIngest } from './ingest';

const app = express();
app.use(express.json({ limit: '200kb' }));

// CORS: GH Pages + anywhere
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ENV
const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || ''; // e.g. /etc/secrets/buyers.txt

// attach user id (from frontend)
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

// ---------- basics ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));

app.get('/__routes', (_req, res) =>
  res.json([
    { path: '/healthz', methods: ['get'] },
    { path: '/__routes', methods: ['get'] },
    { path: '/whoami', methods: ['get'] },
    { path: '/api/v1/status', methods: ['get'] },
    { path: '/api/v1/leads', methods: ['get'] },
    { path: '/api/v1/gate', methods: ['post'] },
    { path: '/api/v1/claim', methods: ['post'] },
    { path: '/api/v1/own', methods: ['post'] },
    { path: '/api/v1/events', methods: ['post'] },
    { path: '/api/v1/debug/peek', methods: ['get'] },
    { path: '/api/v1/admin/seed-brands', methods: ['post'] },
    { path: '/api/v1/admin/ingest', methods: ['post'] },
  ])
);

app.get('/api/v1/status', (_req, res) =>
  res.json({ ok: true, mode: 'vendor-signals', cooldownSec: 0 })
);

// ---------- users ----------
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId;
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  const { region, email, alerts } = req.body || {};
  await q(
    `INSERT INTO app_user(id,region,email,alerts)
     VALUES ($1,$2,$3,COALESCE($4,false))
     ON CONFLICT (id) DO UPDATE
     SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`,
    [userId, region || null, email || null, alerts === true]
  );
  res.json({ ok: true });
});

// ---------- leads feed (NO brand join; just lead_pool) ----------
app.get('/api/v1/leads', async (req, res) => {
  try {
    const r = await q<any>(
      `SELECT id, cat, kw, platform, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool
       WHERE state='available'
       ORDER BY created_at DESC
       LIMIT 40`
    );
    res.json({ ok: true, leads: r.rows, nextRefreshSec: 20 });
  } catch (e: any) {
    res.status(503).json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- claim / own (works with claim_window) ----------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = new Date(Date.now() + 2 * 60000).toISOString();

  const upd = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
                       WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
  if (upd.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
           VALUES ($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const w = await q<any>(
    `SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = w.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);

  res.json({ ok: true });
});

// ---------- events (click/like/mute etc.) ----------
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok: false, error: 'bad request' });

  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
           VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta || {}]);

  // optional mute host → store in user_prefs later (kept simple here)
  res.json({ ok: true });
});

// ---------- debug ----------
app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const total = Number((await q('SELECT COUNT(*) FROM lead_pool')).rows[0]?.count || 0);
    const available = Number((await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`)).rows[0]?.count || 0);
    res.json({
      ok: true,
      counts: { leads_available: available, leads_total: total },
      env: { BRANDS_FILE: !!BRANDS_FILE, BRANDS_FILE_PATH: BRANDS_FILE || null }
    });
  } catch (e: any) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ---------- admin ----------
// Note: this endpoint is a stub so you don’t see 404s. We’re file-scanning on ingest.
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) {
    return res.json({ ok: false, error: 'BRANDS_FILE missing' });
  }
  const lines = fs.readFileSync(BRANDS_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  res.json({ ok: true, inserted: 0, skipped: 0, total: lines.length, note: 'no DB write; file presence validated' });
});

// Single admin ingest endpoint
app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const source = ((req.query.source as string) || 'brandintake').toLowerCase();
  const results: any = {};

  if (source === 'all' || source === 'brandintake') {
    results.brandintake = await runIngest('brandintake'); // inserts into lead_pool
  }

  // No other collectors enabled in this minimal build
  if (!Object.keys(results).length) return res.json({ ok: true, did: 'noop' });

  res.json({ ok: true, did: Object.keys(results), ...results });
});

// ---------- start ----------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
