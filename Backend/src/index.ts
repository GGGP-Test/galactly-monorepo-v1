import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { computeScore, type Weights, type UserPrefs } from './scoring';

/** Optional connectors (safe to keep even if stubs) */
import { findAdvertisersFree } from './connectors/adlib_free';
import { scanPDP } from './connectors/pdp';
import { scanBrandIntake } from './brandintake';
import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';

const app = express();
app.use(express.json({ limit: '300kb' }));

/** CORS for static frontends (GH Pages, Netlify, etc.) */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, x-galactly-user, x-admin-token'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || '';

/** attach pseudo user id for quota & prefs */
app.use((req, _res, next) => {
  (req as any).userId = req.header('x-galactly-user') || null;
  next();
});

/* ---------------- utilities ---------------- */
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}
function normHost(s?: string) {
  if (!s) return '';
  let h = s.trim();
  if (!h) return '';
  h = h.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const i = h.indexOf('/');
  return i > 0 ? h.slice(0, i) : h;
}
async function insertLead(row: {
  platform: string;
  source_url: string;
  title?: string | null;
  snippet?: string | null;
  kw?: string[];
  cat?: string;
  heat?: number;
  meta?: any;
}) {
  const cat = row.cat || 'demand';
  const kw = row.kw || [];
  const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
  await q(
    `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now(), $8)
     ON CONFLICT (source_url) DO NOTHING`,
    [cat, kw, row.platform, heat, row.source_url, row.title ?? null, row.snippet ?? null, row.meta ?? null]
  );
}
async function runSafely<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/* ---------------- basics ---------------- */
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
    { path: '/api/v1/admin/seed-brands', methods: ['post'] },
    { path: '/api/v1/admin/ingest', methods: ['post'] },
    { path: '/api/v1/find-now', methods: ['post'] },
    { path: '/api/v1/reveal', methods: ['post'] },
    { path: '/api/v1/progress.sse', methods: ['get'] }
  ])
);

/* ---------------- quota helpers (stored in app_user.user_prefs.quota) ---------------- */
type Quota = { date: string; findsUsed: number; revealsUsed: number };
const TODAY = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

async function getQuota(userId: string): Promise<Quota> {
  const r = await q<{ user_prefs: any }>(
    'SELECT user_prefs FROM app_user WHERE id=$1',
    [userId]
  );
  const prefs = r.rows[0]?.user_prefs || {};
  const qn = prefs.quota || {};
  const today = TODAY();
  if (qn.date !== today)
    return { date: today, findsUsed: 0, revealsUsed: 0 };
  return {
    date: String(qn.date),
    findsUsed: Number(qn.findsUsed || 0),
    revealsUsed: Number(qn.revealsUsed || 0)
  };
}

async function saveQuota(userId: string, qn: Quota) {
  await q(
    `UPDATE app_user
       SET user_prefs = jsonb_set(
         COALESCE(user_prefs,'{}'::jsonb),
         '{quota}',
         to_jsonb($2::jsonb)
       )
     WHERE id=$1`,
    [userId, qn as any]
  );
}

function resetAtUtc(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/* ---------------- presence (soft signal) ---------------- */
const online: Record<string, number> = {};
app.post('/api/v1/presence/beat', (req, res) => {
  const id = (req as any).userId || randomUUID();
  online[id] = Date.now();
  res.json({ ok: true });
});

/* ---------------- users ---------------- */
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId;
  if (!userId)
    return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
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

/* ---------------- status (engine + free quotas) ---------------- */
app.get('/api/v1/status', async (req, res) => {
  const userId = (req as any).userId || 'anon';
  const freeFindsPerDay = Number(process.env.FREE_FINDS_PER_DAY || 2);
  const freeRevealsPerDay = Number(process.env.FREE_REVEALS_PER_DAY || 2);

  let quota: Quota = { date: TODAY(), findsUsed: 0, revealsUsed: 0 };
  if (userId && userId !== 'anon') quota = await getQuota(userId);

  const findsLeft = Math.max(0, freeFindsPerDay - quota.findsUsed);
  const revealsLeft = Math.max(0, freeRevealsPerDay - quota.revealsUsed);

  res.json({
    ok: true,
    engine: 'ready',
    free: {
      findsLeft,
      revealsLeft,
      resetsAt: resetAtUtc(quota.date),
      perDay: { finds: freeFindsPerDay, reveals: freeRevealsPerDay }
    }
  });
});

/* ---------------- events (like / dislike / mute / confirm) ---------------- */
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type)
    return res.status(400).json({ ok: false, error: 'bad request' });
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta)
     VALUES ($1,$2,$3,$4)`,
    [userId, leadId, String(type), meta || {}]
  );

  if (String(type) === 'mute_domain' && userId && meta?.domain) {
    await q(
      `UPDATE app_user
       SET user_prefs = jsonb_set(
         COALESCE(user_prefs,'{}'::jsonb),
         '{muteDomains}',
         COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text)
       ) WHERE id=$1`,
      [userId, String(meta.domain)]
    );
  }
  res.json({ ok: true });
});

/* ---------------- feed ---------------- */
app.get('/api/v1/leads', async (req, res) => {
  const userId = (req as any).userId || null;
  const r = await q(
    `SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool WHERE state='available'
       ORDER BY created_at DESC LIMIT 40`
  );
  let leads = r.rows as any[];

  // score for user
  const wRow = await q<{ weights: any }>(
    `SELECT weights FROM model_state WHERE segment='global'`
  );
  const weights: Weights =
    (wRow.rows[0]?.weights as Weights) ||
    ({
      coeffs: {
        recency: 0.4,
        platform: 1.0,
        domain: 0.5,
        intent: 0.6,
        histCtr: 0.3,
        userFit: 1.0
      },
      platforms: {},
      badDomains: []
    } as any);

  let prefs: UserPrefs | undefined;
  if (userId) {
    const pr = await q<{ user_prefs: any }>(
      'SELECT user_prefs FROM app_user WHERE id=$1',
      [userId]
    );
    prefs = pr.rows[0]?.user_prefs || undefined;
  }

  leads = leads
    .map((L) => ({ ...L, _score: computeScore(L, weights, prefs) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 20);

  // fallback demo if empty
  if (!leads.length) {
    leads = [
      {
        id: -1,
        cat: 'demo',
        kw: ['packaging'],
        platform: 'demo',
        fit_user: 60,
        heat: 80,
        source_url: 'https://example.com/proof',
        title: 'Demo HOT lead (signals warming up)',
        snippet:
          'This placeholder disappears once your collectors seed real signals.',
        ttl: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        state: 'available',
        created_at: new Date().toISOString(),
        _score: 0
      }
    ];
  }

  const nextRefreshSec = 15;
  res.json({ ok: true, leads: leads.map(({ _score, ...rest }) => rest), nextRefreshSec });
});

/* ---------------- claim / own ---------------- */
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId)
    return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0)
    return res.json({
      ok: true,
      demo: true,
      reservedForSec: 120,
      reveal: null
    });

  const windowId = randomUUID();
  const reservedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const r = await q(
    `UPDATE lead_pool
       SET state='reserved', reserved_by=$1, reserved_at=now()
     WHERE id=$2 AND state='available' RETURNING id`,
    [userId, leadId]
  );
  if (r.rowCount === 0)
    return res.status(409).json({ ok: false, error: 'not available' });
  await q(
    `INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
     VALUES($1,$2,$3,$4)`,
    [windowId, leadId, userId, reservedUntil]
  );
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta)
     VALUES ($1,$2,'claim','{}')`,
    [userId, leadId]
  );
  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId;
  const { windowId } = req.body || {};
  if (!userId || !windowId)
    return res.status(400).json({ ok: false, error: 'bad request' });
  const r = await q<any>(
    `SELECT lead_id FROM claim_window
     WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });
  await q(
    `UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`,
    [userId, leadId]
  );
  await q(
    `INSERT INTO event_log(user_id, lead_id, event_type, meta)
     VALUES ($1,$2,'own','{}')`,
    [userId, leadId]
  );
  res.json({ ok: true });
});

/* ---------------- admin: seed + ingest (legacy helpers) ---------------- */
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE))
    return res.json({ ok: false, error: 'BRANDS_FILE missing' });

  const raw = fs.readFileSync(BRANDS_FILE, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  let inserted = 0,
    skipped = 0;
  for (const line of lines) {
    const parts = line.split(',').map((s) => s.trim());
    const domain = (parts[0] || '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (!domain) {
      skipped++;
      continue;
    }
    const name = parts[1] || domain;
    const sector = parts[2] || null;
    try {
      await q(
        `INSERT INTO brand(name, domain, sector)
         VALUES ($1,$2,$3)
         ON CONFLICT (domain) DO NOTHING`,
        [name, domain, sector]
      );
      inserted++;
    } catch {
      skipped++;
    }
  }
  res.json({ ok: true, inserted, skipped, total: lines.length });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  res.json({ ok: true, did: 'noop' });
});

/* ---------------- find-now (increments free search quota) ---------------- */
app.post('/api/v1/find-now', async (req, res) => {
  const started = Date.now();
  const body = req.body || {};
  const userId = (req as any).userId || null;

  if (userId) {
    const freeFindsPerDay = Number(process.env.FREE_FINDS_PER_DAY || 2);
    let quota = await getQuota(userId);
    if (quota.date !== TODAY())
      quota = { date: TODAY(), findsUsed: 0, revealsUsed: 0 };
    if (quota.findsUsed >= freeFindsPerDay) {
      return res
        .status(429)
        .json({ ok: false, error: 'free_limit_reached', message: 'Daily free searches used.' });
    }
    quota.findsUsed += 1;
    await saveQuota(userId, quota);
  }

  const buyersRaw: string[] = Array.isArray(body.buyers) ? body.buyers : [];
  const industries: string[] = Array.isArray(body.industries) ? body.industries : [];
  const regions: string[] = Array.isArray(body.regions) ? body.regions : [];
  let seedDomains = buyersRaw.map(normHost).filter(Boolean);

  if ((!seedDomains.length) && body.vendorDomain) {
    const icp = await runSafely(deriveBuyersFromVendorSite(String(body.vendorDomain)));
    const derived = (icp?.buyers || [])
      .map((b: any) => normHost(b.domain))
      .filter(Boolean);
    seedDomains = Array.from(new Set([...seedDomains, ...derived])).slice(0, 20);
  }

  const advertisers = (await runSafely(
    findAdvertisersFree({ industries, regions, seedDomains })
  )) || [];
  const advDomains = advertisers.map((a: any) => normHost(a.domain)).filter(Boolean);
  const domainSet = new Set<string>([...seedDomains, ...advDomains]);
  const domains = Array.from(domainSet).slice(0, Number(process.env.FIND_MAX_DOMAINS || 40));

  let created = 0, checked = 0; const seenUrl = new Set<string>();

  for (const host of domains) {
    // ad proof
    for (const a of advertisers.filter((x: any) => normHost(x.domain) === host)) {
      if (a.proofUrl && !seenUrl.has(a.proofUrl)) {
        await insertLead({
          platform: 'adlib_free',
          source_url: a.proofUrl,
          title: `${host} — ad transparency search`,
          snippet: `Source: ${a.source || 'ads'} • Last seen: ${a.lastSeen || 'recent'} • ~${a.adCount ?? '?' } creatives`,
          kw: ['ads', 'buyer', 'spend'],
          cat: 'demand',
          heat: 70,
          meta: { domain: host, platform: a.source || 'ads' }
        });
        seenUrl.add(a.proofUrl); created++;
      }
    }
    // intake
    const intakeHits = (await runSafely(scanBrandIntake(host))) || [];
    for (const h of intakeHits) {
      if (!seenUrl.has(h.url)) {
        await insertLead({
          platform: 'brandintake',
          source_url: h.url,
          title: h.title || `${host} — Supplier/Procurement`,
          snippet: h.snippet || host,
          kw: ['procurement', 'supplier', 'packaging'],
          cat: 'procurement',
          heat: 82,
          meta: { domain: host }
        });
        seenUrl.add(h.url); created++;
      }
    }
    // pdp
    const pdpHits = (await runSafely(scanPDP(host))) || [];
    for (const p of pdpHits) {
      if (!seenUrl.has(p.url)) {
        await insertLead({
          platform: p.type || 'pdp',
          source_url: p.url,
          title: p.title || `${host} product`,
          snippet: p.snippet || '',
          kw: ['case', 'pack', 'dims'],
          cat: 'product',
          heat: p.type === 'restock_post' ? 78 : 68,
          meta: { domain: host }
        });
        seenUrl.add(p.url); created++;
      }
    }
    checked++;
  }

  // if no leads got created, drop one demo so UX shows movement
  if (!created) {
    await insertLead({
      platform: 'demo',
      source_url: `https://example.com/demo-${Date.now()}`,
      title: 'Demo signal (collectors warming up)',
      snippet: 'This disappears once real signals are inserted.',
      kw: ['demo'],
      cat: 'demand',
      heat: 65
    });
    created = 1;
  }

  res.json({ ok: true, checked, created, tookMs: Date.now() - started });
});

/* ---------------- reveal (increments free reveal quota) ---------------- */
app.post('/api/v1/reveal', async (req, res) => {
  const userId = (req as any).userId || null;
  if (userId) {
    const freeRevealsPerDay = Number(process.env.FREE_REVEALS_PER_DAY || 2);
    let quota = await getQuota(userId);
    if (quota.date !== TODAY())
      quota = { date: TODAY(), findsUsed: 0, revealsUsed: 0 };
    if (quota.revealsUsed >= freeRevealsPerDay) {
      return res
        .status(429)
        .json({ ok: false, error: 'free_limit_reached', message: 'Daily free reveals used.' });
    }
    quota.revealsUsed += 1;
    await saveQuota(userId, quota);
  }
  res.json({ ok: true, reveal: { allowed: true } });
});

/* ---------------- progress.sse (signals preview stream) ---------------- */
app.get('/api/v1/progress.sse', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sid = (req.query.sid as string) || randomUUID();

  function send(ev: string, data: any) {
    res.write(`event: ${ev}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  send('hello', { sid, startedAt: Date.now() });

  const CAPS: [string, string][] = [
    ['Demand', 'Paid reach probes (Meta, Google)'],
    ['Product', 'SKU & restock cadence'],
    ['Procurement', 'Supplier / intake changes'],
    ['Wholesale', 'B2B case-pack shifts'],
    ['Retail', 'Retail PDP deltas, promos'],
    ['Ops', 'Hiring/shift spikes'],
    ['Events', 'Trade / promo calendar']
  ];

  const STEPS: { id: string; cap: string; label: string }[] = [];
  for (const [cap, label] of CAPS) {
    for (let i = 0; i < 4; i++) STEPS.push({ id: `${cap.toLowerCase()}_${i+1}`, cap, label });
  }

  let i = 0;
  const maxFree = Math.min(24, STEPS.length);
  const timer = setInterval(() => {
    if (i >= maxFree) {
      send('halt', { reason: 'free_cap', shown: i, total: STEPS.length });
      clearInterval(timer);
      setTimeout(() => { try { res.end(); } catch { /* noop */ } }, 1200);
      return;
    }
    const S = STEPS[i++];
    send('step', { index: i, of: STEPS.length, cap: S.cap, label: S.label, id: S.id, ts: Date.now() });
  }, 1800);

  const hb = setInterval(() => send('ping', { t: Date.now() }), 15000);
  req.on('close', () => { clearInterval(timer); clearInterval(hb); });
});

/* ---------------- start ---------------- */
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`galactly-api listening on :${PORT}`)
  );
});
