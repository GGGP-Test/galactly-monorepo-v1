import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { migrate, q } from './db';
import { nowPlusMinutes } from './util';
import { computeScore, type Weights, type UserPrefs } from './scoring';

// Optional connectors (present in this repo). Keep imports static so builds succeed.
import { findAdvertisersFree } from './connectors/adlib_free';
import { scanPDP } from './connectors/pdp';
import { scanBrandIntake } from './brandintake';
import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';

const app = express();
app.use(express.json({ limit: '300kb' }));

// --- CORS (permissive for GH Pages / static hosting) ---
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

// Attach pseudo user id from header
app.use((req, _res, next) => { (req as any).userId = req.header('x-galactly-user') || null; next(); });

// -------------------- utils --------------------
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return !!ADMIN_TOKEN && t === ADMIN_TOKEN;
}
function normHost(s?: string){ if(!s) return ''; let h = s.trim(); if(!h) return ''; h = h.replace(/^https?:\/\//i, '').replace(/\/$/, ''); const i=h.indexOf('/'); return i>0? h.slice(0,i): h; }
async function insertLead(row: { platform: string; source_url: string; title?: string|null; snippet?: string|null; kw?: string[]; cat?: string; heat?: number; meta?: any; }){
  const cat = row.cat || 'demand';
  const kw = row.kw || [];
  const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
  await q(
    `INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now(), $8)
     ON CONFLICT (source_url) DO NOTHING`,
    [cat, kw, row.platform, heat, row.source_url, row.title || null, row.snippet || null, row.meta || null]
  );
}
async function runSafely<T>(p: Promise<T>): Promise<T|null>{ try { return await p; } catch { return null; } }

// -------------------- basics --------------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));
app.get('/__routes', (_req, res) => {
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
    { path: '/api/v1/admin/seed-brands', methods: ['post'] },
    { path: '/api/v1/find-now', methods: ['post'] },
    { path: '/api/v1/progress.sse', methods: ['get'] },
  ]);
});
app.get('/api/v1/status', (_req, res) => res.json({ ok: true, mode: 'vendor-signals' }));

// -------------------- presence (soft) --------------------
const online: Record<string, number> = {};
app.post('/api/v1/presence/beat', (req, res) => { const id = (req as any).userId || randomUUID(); online[id] = Date.now(); res.json({ ok: true }); });
app.get('/api/v1/presence/online', (_req, res) => {
  const now = Date.now(); for (const k of Object.keys(online)) if (now - online[k] > 30000) delete online[k];
  const real = Object.keys(online).length; const display = Math.max(34, Math.round(real * 0.9 + 6));
  res.json({ ok: true, real, displayed: display });
});

// -------------------- users --------------------
app.post('/api/v1/gate', async (req, res) => {
  const userId = (req as any).userId; if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  const { region, email, alerts } = req.body || {};
  await q(
    `INSERT INTO app_user(id,region,email,alerts)
     VALUES ($1,$2,$3,COALESCE($4,false))
     ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`,
    [userId, region || null, email || null, alerts === true]
  );
  res.json({ ok: true });
});

// -------------------- events (like / dislike / mute / confirm) --------------------
app.post('/api/v1/events', async (req, res) => {
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok:false, error:'bad request' });
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta || {}]);

  if (String(type) === 'mute_domain' && userId && meta?.domain) {
    await q(`UPDATE app_user SET user_prefs = jsonb_set(COALESCE(user_prefs,'{}'::jsonb), '{muteDomains}', COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text)) WHERE id=$1`, [userId, String(meta.domain)]);
  }
  res.json({ ok:true });
});

// -------------------- feed --------------------
app.get('/api/v1/leads', async (req, res) => {
  const userId = (req as any).userId || null;
  const r = await q(
    `SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at
       FROM lead_pool WHERE state='available'
       ORDER BY created_at DESC LIMIT 40`
  );
  let leads = r.rows as any[];

  // scoring (global weights + per-user prefs)
  const wRow = await q<{ weights: any }>(`SELECT weights FROM model_state WHERE segment='global'`);
  const weights: Weights = (wRow.rows[0]?.weights as Weights) || { coeffs:{recency:0.4,platform:1.0,domain:0.5,intent:0.6,histCtr:0.3,userFit:1.0}, platforms:{}, badDomains:[] } as any;
  let prefs: UserPrefs | undefined; if (userId) { const pr = await q<{ user_prefs: any }>('SELECT user_prefs FROM app_user WHERE id=$1', [userId]); prefs = pr.rows[0]?.user_prefs || undefined; }
  leads = leads.map(L => ({ ...L, _score: computeScore(L, weights, prefs) })).sort((a,b)=>b._score-a._score).slice(0, 20);

  // fallback demo
  if (!leads.length) {
    leads = [{ id: -1, cat: 'demo', kw: ['packaging'], platform: 'demo', fit_user: 60, heat: 80, source_url: 'https://example.com/proof', title: 'Demo HOT lead (signals warming up)', snippet: 'This placeholder disappears once your signal ingestors run.', ttl: nowPlusMinutes(60).toISOString(), state: 'available', created_at: new Date().toISOString(), _score:0 }];
  }

  const nextRefreshSec = 15;
  res.json({ ok: true, leads: leads.map(({_score, ...rest})=>rest), nextRefreshSec });
});

// -------------------- claim / own --------------------
app.post('/api/v1/claim', async (req, res) => {
  const userId = (req as any).userId;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok: true, demo: true, reservedForSec: 120, reveal: null });

  const windowId = randomUUID();
  const reservedUntil = nowPlusMinutes(2).toISOString();
  const r = await q(
    `UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
     WHERE id=$2 AND state='available' RETURNING id`,
    [userId, leadId]
  );
  if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });
  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until) VALUES($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);
  res.json({ ok: true, windowId, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req, res) => {
  const userId = (req as any).userId; const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });
  const r = await q<any>(
    `SELECT lead_id FROM claim_window
     WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`,
    [windowId, userId]
  );
  const leadId = r.rows[0]?.lead_id; if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });
  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);
  res.json({ ok: true });
});

// -------------------- admin: seed + ingest (legacy) --------------------
app.post('/api/v1/admin/seed-brands', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) return res.json({ ok: false, error: 'BRANDS_FILE missing' });

  const raw = fs.readFileSync(BRANDS_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let inserted = 0, skipped = 0;
  for (const line of lines) {
    const parts = line.split(',').map(s => s.trim());
    const domain = (parts[0] || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!domain) { skipped++; continue; }
    const name = parts[1] || domain; const sector = parts[2] || null;
    try {
      await q(`INSERT INTO brand(name, domain, sector) VALUES ($1,$2,$3) ON CONFLICT (domain) DO NOTHING`, [name, domain, sector]);
      inserted++;
    } catch { skipped++; }
  }
  res.json({ ok: true, inserted, skipped, total: lines.length });
});

app.post('/api/v1/admin/ingest', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  // kept for compatibility; your collectors may call this later
  res.json({ ok: true, did: 'noop' });
});

// -------------------- debug --------------------
app.get('/api/v1/debug/peek', async (_req, res) => {
  try {
    const lAvail = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const lTotal = await q(`SELECT COUNT(*) FROM lead_pool`);
    res.json({ ok: true, counts: { leads_available: Number(lAvail.rows[0]?.count || 0), leads_total: Number(lTotal.rows[0]?.count || 0) }, env: { BRANDS_FILE: !!BRANDS_FILE, BRANDS_FILE_PATH: BRANDS_FILE || null } });
  } catch (e:any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------- NEW: /api/v1/find-now  (free path: advertisers → intake → pdp) --------------------
app.post('/api/v1/find-now', async (req, res) => {
  const started = Date.now();
  const body = req.body || {};
  const buyersRaw: string[] = Array.isArray(body.buyers) ? body.buyers : [];
  const industries: string[] = Array.isArray(body.industries) ? body.industries : [];
  const regions: string[] = Array.isArray(body.regions) ? body.regions : [];

  let seedDomains = buyersRaw.map(normHost).filter(Boolean);

  // If no buyers provided but vendorDomain is set, derive a few similar brands (free heuristic)
  if ((!seedDomains.length) && body.vendorDomain) {
    const icp = await runSafely(deriveBuyersFromVendorSite(String(body.vendorDomain)));
    const derived = (icp?.buyers || []).map((b:any)=>normHost(b.domain)).filter(Boolean);
    seedDomains = Array.from(new Set([...seedDomains, ...derived])).slice(0, 20);
  }

  // Expand via free ad libraries (query URLs as proof)
  const advertisers = await runSafely(findAdvertisersFree({ industries, regions, seedDomains })) || [];
  const advDomains = advertisers.map((a:any)=>normHost(a.domain)).filter(Boolean);
  const domainSet = new Set<string>([...seedDomains, ...advDomains]);
  const domains = Array.from(domainSet).slice(0, Number(process.env.FIND_MAX_DOMAINS || 40));

  let created = 0, checked = 0; const seenUrl = new Set<string>();

  for (const host of domains){
    // Ad proof links (so vendors can DIY-verify; medium heat)
    for (const a of advertisers.filter((x:any)=> normHost(x.domain) === host)){
      if (a.proofUrl && !seenUrl.has(a.proofUrl)){
        await insertLead({ platform:'adlib_free', source_url:a.proofUrl, title: `${host} — ad transparency search`, snippet: `Source: ${a.source || 'ads'} • Last seen: ${a.lastSeen || 'recent'} • ~${a.adCount ?? '?'} creatives`, kw:['ads','buyer','spend'], cat:'demand', heat:70, meta:{domain:host, platform:a.source||'ads'} });
        seenUrl.add(a.proofUrl); created++;
      }
    }

    // Intake / procurement
    const intakeHits = await runSafely(scanBrandIntake(host)) || [];
    for (const h of intakeHits){
      if (!seenUrl.has(h.url)){
        await insertLead({ platform:'brandintake', source_url:h.url, title: h.title || `${host} — Supplier/Procurement`, snippet: h.snippet || host, kw:['procurement','supplier','packaging'], cat:'procurement', heat:82, meta:{domain:host} });
        seenUrl.add(h.url); created++;
      }
    }

    // PDP / product signals
    const pdpHits = await runSafely(scanPDP(host)) || [];
    for (const p of pdpHits){
      if (!seenUrl.has(p.url)){
        await insertLead({ platform: p.type || 'pdp', source_url: p.url, title: p.title || `${host} product`, snippet: p.snippet || '', kw: ['case','pack','dims'], cat:'product', heat: p.type==='restock_post'?78:68, meta:{domain:host} });
        seenUrl.add(p.url); created++;
      }
    }

    checked++;
  }

  res.json({ ok:true, checked, created, advertisers: advertisers.length, tookMs: Date.now()-started });
});

// -------------------- NEW: /api/v1/progress.sse (Server-Sent Events for right-column metric preview) --------------------
app.get('/api/v1/progress.sse', async (req, res) => {
  // headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const userId = (req as any).userId || 'anon';
  const sid = (req.query.sid as string) || randomUUID();
  const vendor = (req.query.vendor as string) || '';
  const industries = String(req.query.industries || '').split(',').filter(Boolean);
  const regions = String(req.query.regions || '').split(',').filter(Boolean);

  function send(ev: string, data: any){ res.write(`event: ${ev}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); }

  // initial handshake
  send('hello', { sid, userId, vendor, industries, regions, startedAt: Date.now() });

  // A curated sequence of ~40 steps; we will emit slowly (every ~2s) and stop ~20–25 items on free plan
  const STEPS: { id: string; cap: string; detail: string }[] = [];
  const caps = [
    ['Demand', 'Ad-velocity scan (Meta, Google, Reddit mentions)'],
    ['Product', 'SKU & variety churn (case-of-N, restocks, new flavor cadence)'],
    ['Procurement', 'Supplier portal changes, vendor intake forms'],
    ['Social', 'Creator whitelisting, UGC bursts'],
    ['Retail', 'Retailer PDP deltas, price promotions'],
    ['Wholesale', 'B2B pages, case-pack MOQ shifts'],
    ['Ops', 'Fulfillment spikes (job posts, shift adds)'],
    ['Events', 'Trade calendar alignment']
  ];
  let ctr = 0;
  for (const [cap, label] of caps){
    for (let i=0;i<6;i++){
      STEPS.push({ id: `${cap.toLowerCase()}_${i+1}`, cap, detail: label });
    }
  }

  // emit loop
  let idx = 0;
  const maxFree = Math.min(26, STEPS.length); // stop early on free
  const timer = setInterval(() => {
    if (idx >= STEPS.length) idx = 0;
    if (idx >= maxFree){
      send('halt', { reason: 'free_cap', shown: idx, total: STEPS.length, upsell: { title: 'Unlock full scan & auto-enrichment', plan: 'Pro', price: '$39/mo' } });
      clearInterval(timer);
      // leave connection open a little for client animation grace; then end
      setTimeout(() => { try { res.end(); } catch {} }, 1500);
      return;
    }
    const S = STEPS[idx++]; ctr++;
    send('step', { index: idx, of: STEPS.length, cap: S.cap, label: S.detail, id: S.id, ts: Date.now() });
  }, 1800);

  // heartbeat every 15s
  const hb = setInterval(() => { send('ping', { t: Date.now() }); }, 15000);

  req.on('close', () => { clearInterval(timer); clearInterval(hb); });
});

// -------------------- start --------------------
migrate().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
