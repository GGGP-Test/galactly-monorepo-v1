import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

/**
 * ENV expected:
 *  PORT=8787
 *  DATABASE_URL=postgres://...
 *  ADMIN_TOKEN=...
 *  BRANDS_FILE=/etc/secrets/brands.csv      # seed list you uploaded (domain,name,...)
 */

const app = express();
app.use(express.json({ limit: '256kb' }));

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
const BRANDS_FILE = process.env.BRANDS_FILE || '';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
async function q<T=any>(sql: string, params?: any[]) { return pool.query<T>(sql, params as any); }

// ---------- schema (idempotent) ----------
async function migrate() {
  await q(`
  CREATE TABLE IF NOT EXISTS app_user(
    id TEXT PRIMARY KEY,
    region TEXT,
    email TEXT,
    alerts BOOLEAN DEFAULT FALSE,
    user_prefs JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS brand(
    id BIGSERIAL PRIMARY KEY,
    name TEXT,
    domain TEXT UNIQUE,
    sector TEXT,
    geo_hint TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS signal(
    id BIGSERIAL PRIMARY KEY,
    brand_id BIGINT REFERENCES brand(id) ON DELETE CASCADE,
    type TEXT,                         -- rfq_page | supplier_page_change | restock_post | new_sku | ad_surge | retail_expansion | pdp_change
    url TEXT,
    ts TIMESTAMPTZ DEFAULT now(),
    payload JSONB
  );
  CREATE INDEX IF NOT EXISTS idx_signal_brand_time ON signal(brand_id, ts DESC);

  CREATE TABLE IF NOT EXISTS lead_pool(
    id BIGSERIAL PRIMARY KEY,
    brand_id BIGINT REFERENCES brand(id) ON DELETE CASCADE,
    platform TEXT,                     -- derived: rfq/ad/pdp/etc
    source_url TEXT,
    title TEXT,
    snippet TEXT,
    heat INT DEFAULT 50,               -- 0..100
    confidence REAL DEFAULT 0,         -- 0..1
    ttl TIMESTAMPTZ,
    state TEXT DEFAULT 'available',    -- available | reserved | owned
    reserved_by TEXT,
    reserved_at TIMESTAMPTZ,
    owned_by TEXT,
    owned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lead_state_time ON lead_pool(state, created_at DESC);

  CREATE TABLE IF NOT EXISTS claim_window(
    window_id TEXT PRIMARY KEY,
    lead_id BIGINT REFERENCES lead_pool(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES app_user(id) ON DELETE SET NULL,
    reserved_until TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS event_log(
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    lead_id BIGINT,
    event_type TEXT,       -- impression|click|like|dislike|mute_domain|claim|own
    created_at TIMESTAMPTZ DEFAULT now(),
    meta JSONB
  );
  CREATE INDEX IF NOT EXISTS idx_event_lead ON event_log(lead_id);
  CREATE INDEX IF NOT EXISTS idx_event_user ON event_log(user_id);
  `);
}

// ---------- helpers ----------
const nowPlusMin = (m:number)=> new Date(Date.now()+m*60*1000);
function isAdmin(req: express.Request) {
  const t = (req.query.token as string) || req.header('x-admin-token') || '';
  return ADMIN_TOKEN && t === ADMIN_TOKEN;
}
(app as any).userId = null;
app.use((req,_res,next)=>{ (req as any).userId = req.header('x-galactly-user') || null; next(); });

// ---------- tiny scoring for vendor-signals ----------
function scoreLead(sigType: string, ageMin: number) {
  // Freshness (<=72h) + signal type weight
  const fresh = Math.max(0, 1 - ageMin/ (72*60));
  const typeW = ({
    rfq_page: 1.0,
    supplier_page_change: 0.8,
    ad_surge: 0.6,
    restock_post: 0.6,
    new_sku: 0.5,
    retail_expansion: 0.5,
    pdp_change: 0.4
  } as Record<string,number>)[sigType] ?? 0.3;
  const confidence = Math.min(1, 0.4*fresh + 0.6*typeW);
  const heat = Math.round(100 * (0.6*confidence + 0.4*fresh));
  return { confidence, heat };
}

// ---------- seed brands from BRANDS_FILE ----------
async function seedBrandsFromFile() {
  if (!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) return { ok:false, error:'BRANDS_FILE missing' };
  const raw = fs.readFileSync(BRANDS_FILE, 'utf8');
  const lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let inserted=0, skipped=0;
  for (const line of lines) {
    // Accept "domain,name,sector" OR just "domain"
    const parts = line.split(',').map(s=>s.trim());
    const domain = (parts[0]||'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
    if (!domain) { skipped++; continue; }
    const name = parts[1] || domain;
    const sector = parts[2] || null;
    try {
      await q(`INSERT INTO brand(name, domain, sector) VALUES ($1,$2,$3) ON CONFLICT (domain) DO NOTHING`, [name, domain, sector]);
      inserted++;
    } catch { skipped++; }
  }
  return { ok:true, inserted, skipped, total: lines.length };
}

// ---------- stub: derive leads from recent signals ----------
async function deriveLeadsFromSignals(limit=50) {
  // Pick most recent signals per brand in last 72h; convert to leads if not already present
  const r = await q<any>(`
    WITH recent AS (
      SELECT s.*, b.name, b.domain,
             EXTRACT(EPOCH FROM (now() - s.ts))/60.0 AS age_min
      FROM signal s
      JOIN brand b ON b.id = s.brand_id
      WHERE s.ts > now() - interval '72 hours'
      ORDER BY s.ts DESC
      LIMIT $1
    )
    SELECT * FROM recent
  `,[limit]);

  let created = 0;
  for (const row of r.rows) {
    const { confidence, heat } = scoreLead(row.type, Number(row.age_min||0));
    // Upsert lead by (brand_id, url)
    await q(`
      INSERT INTO lead_pool(brand_id, platform, source_url, title, snippet, heat, confidence, ttl)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT DO NOTHING
    `, [
      row.brand_id,
      row.type,
      row.url,
      row.payload?.title || `${row.name} — ${row.type}`,
      row.payload?.snippet || row.domain,
      Math.max(30, Math.min(95, heat)),
      Math.min(1, Math.max(0, confidence)),
      nowPlusMin(180).toISOString()
    ]).then(r2 => { if ((r2 as any).rowCount>0) created++; }).catch(()=>{});
  }
  return { ok:true, created };
}

// ---------- presence (soft) ----------
const online: Record<string, number> = {};
app.post('/api/v1/presence/beat', (req,res)=>{
  const id = req.header('x-galactly-user') || randomUUID();
  online[id] = Date.now();
  res.json({ ok:true });
});
app.get('/api/v1/presence/online', (_req,res)=>{
  const now = Date.now();
  for (const k of Object.keys(online)) if (now - online[k] > 30000) delete online[k];
  // keep floor to 30–40 display to avoid “empty room” effect
  const real = Object.keys(online).length;
  const display = Math.max(34, Math.round(real*0.9 + 6));
  res.json({ ok:true, real, displayed: display });
});

// ---------- basics ----------
app.get('/healthz', (_req,res)=>res.json({ ok:true }));
app.get('/__routes', (_req,res)=>res.json([
  { path:'/healthz', methods:['get'] },
  { path:'/__routes', methods:['get'] },
  { path:'/api/v1/status', methods:['get'] },
  { path:'/api/v1/presence/beat', methods:['post'] },
  { path:'/api/v1/presence/online', methods:['get'] },
  { path:'/api/v1/gate', methods:['post'] },
  { path:'/api/v1/leads', methods:['get'] },
  { path:'/api/v1/claim', methods:['post'] },
  { path:'/api/v1/own', methods:['post'] },
  { path:'/api/v1/debug/peek', methods:['get'] },
  { path:'/api/v1/admin/seed-brands', methods:['post'] },
  { path:'/api/v1/admin/ingest', methods:['post'] }
]));
app.get('/api/v1/status', (_req,res)=>res.json({ ok:true, mode:'vendor-signals' }));

// ---------- gate ----------
app.post('/api/v1/gate', async (req,res)=>{
  const userId = (req as any).userId || null;
  if (!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  const { region, email, alerts } = req.body || {};
  await q(`INSERT INTO app_user(id,region,email,alerts)
           VALUES ($1,$2,$3,COALESCE($4,false))
           ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`,
           [userId, region||null, email||null, alerts===true]);
  res.json({ ok:true });
});

// ---------- leads feed (ranked) ----------
app.get('/api/v1/leads', async (_req,res)=>{
  // prefer freshest + hottest
  const r = await q<any>(`
    SELECT l.id, l.platform, l.source_url, l.title, l.snippet, l.heat, l.confidence, l.state, l.created_at,
           b.name as brand_name, b.domain
    FROM lead_pool l
    JOIN brand b ON b.id = l.brand_id
    WHERE l.state='available'
    ORDER BY l.heat DESC, l.created_at DESC
    LIMIT 30
  `);
  let leads = r.rows.map((x:any)=>({
    id: x.id,
    platform: x.platform,
    source_url: x.source_url,
    title: x.title || x.brand_name,
    snippet: x.snippet || x.domain,
    heat: x.heat,
    confidence: x.confidence,
    state: x.state,
    created_at: x.created_at
  }));
  // if empty, show a tiny demo card so UI isn't blank
  if (!leads.length) {
    leads = [{
      id: -1,
      platform: 'ad_surge',
      source_url: 'https://example.com/proof',
      title: 'Demo HOT lead (signals warming up)',
      snippet: 'This placeholder disappears once your signal ingestors run.',
      heat: 80, confidence: 0.75, state: 'available', created_at: new Date().toISOString()
    }];
  }
  res.json({ ok:true, leads, nextRefreshSec: 20 });
});

// ---------- claim / own ----------
app.post('/api/v1/claim', async (req,res)=>{
  const userId = (req as any).userId || null;
  const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok:true, demo:true, reservedForSec:120, reveal:null });

  const win = randomUUID();
  const reservedUntil = nowPlusMin(2).toISOString();

  const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
                     WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
  if (r.rowCount === 0) return res.status(409).json({ ok:false, error:'not available' });

  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until)
           VALUES($1,$2,$3,$4)`, [win, leadId, userId, reservedUntil]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);

  res.json({ ok:true, windowId: win, reservedForSec: 120, reveal: {} });
});

app.post('/api/v1/own', async (req,res)=>{
  const userId = (req as any).userId || null;
  const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok:false, error:'bad request' });

  const r = await q<any>(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
  const leadId = r.rows[0]?.lead_id;
  if (!leadId) return res.status(410).json({ ok:false, error:'window expired' });

  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);

  res.json({ ok:true });
});

// ---------- admin: seed & ingest ----------
app.post('/api/v1/admin/seed-brands', async (req,res)=>{
  if (!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
  const out = await seedBrandsFromFile();
  res.json(out);
});

app.post('/api/v1/admin/ingest', async (req,res)=>{
  if (!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
  const { source } = req.query as any;
  // For now, only “signals→leads” materializer. (Signal collectors will be separate files/jobs.)
  if (source === 'signals' || source === 'all' || !source) {
    const out = await deriveLeadsFromSignals(80);
    return res.json({ ok:true, did:'derive_leads', ...out });
  }
  res.json({ ok:true, did:'noop' });
});

// ---------- debug ----------
app.get('/api/v1/debug/peek', async (_req,res)=>{
  const b = await q('SELECT COUNT(*) FROM brand');
  const s = await q('SELECT COUNT(*) FROM signal');
  const l = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
  res.json({
    ok:true,
    counts: {
      brands: Number(b.rows[0].count||0),
      signals: Number(s.rows[0].count||0),
      leads_available: Number(l.rows[0].count||0)
    },
    env: {
      BRANDS_FILE: !!BRANDS_FILE
    }
  });
});

// ---------- start ----------
migrate().then(()=>{
  app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api (vendor-signals) on :${PORT}`));
});
