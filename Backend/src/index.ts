import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { migrate, q } from './db';
import { computeScore, type Weights, type UserPrefs } from './scoring';
import { nowPlusMinutes, toISO } from './util';
import { runIngest } from './ingest';

const app = express();
app.use(express.json({ limit: '200kb' }));

// CORS (GH Pages + anywhere)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}

// attach user id from header (optional)
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

// ---------- basics ----------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));
app.get('/__routes', (_req, res) =>
  res.json([
    { path: '/healthz', methods: ['get'] },
    { path: '/__routes', methods: ['get'] },
    { path: '/whoami', methods: ['get'] },
    { path: '/api/v1/status', methods: ['get'] },
    { path: '/api/v1/gate', methods: ['post'] },
    { path: '/api/v1/leads', methods: ['get'] },
    { path: '/api/v1/claim', methods: ['post'] },
    { path: '/api/v1/own', methods: ['post'] },
    { path: '/api/v1/events', methods: ['post'] },
    { path: '/api/v1/debug/peek', methods: ['get'] },
    { path: '/api/v1/admin/ingest', methods: ['post'] },
    { path: '/api/v1/admin/poll-now', methods: ['get'] }
  ])
);

app.get('/api/v1/status', (_req, res) =>
  res.json({ ok: true, mode: 'vendor-signals', cooldownSec: 0 })
);

// ---------- gate ----------
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

// ---------- events (like/dislike/mute/claim/own telemetry) ----------
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok: false, error: 'bad request' });
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`,
    [userId, Number(leadId), String(type), meta || {}]
  );
  // optional: persist mute domain in user_prefs
  if (type === 'mute_domain' && userId && meta?.domain) {
    await q(
      `UPDATE app_user
         SET user_prefs = jsonb_set(
             COALESCE(user_prefs,'{}'::jsonb),
             '{muteDomains}',
             COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text)
           )
       WHERE id=$1`,
      [userId, meta.domain]
    );
  }
  res.json({ ok: true });
});

// ---------- leads feed (ranked) ----------
app.get('/api/v1/leads', async (req, res) => {
  const userId = (req as any).userId || null;
  const limit = 40;

  const r = await q<any>(
    `SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool
      WHERE state='available'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  let leads = r.rows as any[];

  // weights + user prefs
  const wRow = await q<{ weights: any }>(`SELECT weights FROM model_state WHERE segment='global'`);
  const weights: Weights =
    (wRow.rows[0]?.weights as Weights) ||
    ({ coeffs: { recency: 0.4, platform: 1.0, domain: 0.5, intent: 0.6, histCtr: 0.3, userFit: 1.0 }, platforms: {}, badDomains: [] } as any);

  let prefs: UserPrefs | undefined;
  if (userId) {
    const pr = await q<{ user_prefs: any }>('SELECT user_prefs FROM app_user WHERE id=$1', [userId]);
    prefs = pr.rows[0]?.user_prefs || undefined;
  }

  // score & rank
  leads = leads
    .map((L) => ({ ...L, _score: computeScore(L, weights, prefs) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 20);

  // record impressions
  if (userId && leads.length) {
    const vals = leads
      .map((L) => `('${userId}', ${Number(L.id)}, 'impression', now(), '{}'::jsonb)`)
      .join(',');
    await q(`INSERT INTO event_log (user_id, lead_id, event_type, created_at, meta) VALUES ${vals}`);
  }

  // tiny demo pad so UI isn't blank
  if (leads.length < 1) {
    leads.push({
      id: -1,
      cat: 'demo',
      kw: ['packaging'],
      platform: 'demo',
      fit_user: 60,
      heat: 60,
      source_url: 'https://example.com/demo',
      title: 'Demo HOT lead (signals warming up)',
      snippet: 'This placeholder disappears once your signal ingestors run.',
      ttl: toISO(nowPlusMinutes(60)),
      state: 'available',
      created_at: new Date().toISOString(),
      _score: 0
    });
  }

  res.json({ ok: true, leads: leads.map(({ _score, ...rest }) => rest), nextRefreshSec: 20 });
});

// ---------- claim / own ----------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2);

  const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now() WHERE id=$2 AND state='available' RETURNING id`, [
    userId,
    Number(leadId)
  ]);
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });

  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until) VALUES($1,$2,$3,$4)`, [
    windowId,
    Number(leadId),
    userId,
    reservedUntil
  ]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, Number(leadId)]);

  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });

  const r = await q<{ lead_id: number }>(
    `SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);

  res.json({ ok: true });
});

// ---------- admin: ingest (brandintake/signals) ----------
app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const source = (req.query.source as string) || 'all';
  const out = await runIngest(source);
  res.json({ ok: true, ...out });
});

// alias for GET-based callers
app.get('/api/v1/admin/poll-now', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const source = (req.query.source as string) || 'all';
  const out = await runIngest(source);
  res.json({ ok: true, ...out });
});

// ---------- debug ----------
app.get('/api/v1/debug/peek', async (_req, res) => {
  const avail = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
  const total = await q(`SELECT COUNT(*) FROM lead_pool`);
  res.json({
    ok: true,
    counts: { leads_available: Number(avail.rows[0].count || 0), leads_total: Number(total.rows[0].count || 0) },
    env: {
      BRANDS_FILE: !!process.env.BRANDS_FILE,
      BRANDS_FILE_PATH: process.env.BRANDS_FILE || null
    }
  });
});

// ---------- start ----------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
