import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { nowPlusMinutes } from './util';
import { computeScore, type Weights, type UserPrefs, interleaveByPlatform } from './scoring';
import { findAdvertisersFree } from './connectors/adlib_free';
import { scanPDP } from './connectors/pdp';
import { scanBrandIntake } from './brandintake';
import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';

const app = express();
app.use(express.json({ limit: '300kb' }));
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token'); res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(200); next(); });

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

app.use((req, _res, next) => { (req as any).userId = req.header('x-galactly-user') || null; next(); });

function isAdmin(req: express.Request) { const t = (req.query.token as string) || req.header('x-admin-token') || ''; return !!ADMIN_TOKEN && t === ADMIN_TOKEN; }
function normHost(s?: string){ if(!s) return ''; let h = s.trim(); if(!h) return ''; h=h.replace(/^https?:\/\//i,'').replace(/\/$/,''); const slash=h.indexOf('/'); return slash>0? h.slice(0,slash):h; }

async function insertLead(row: { platform: string; source_url: string; title?: string | null; snippet?: string | null; kw?: string[]; cat?: string; heat?: number; }){
  const cat = row.cat || 'demand';
  const kw = row.kw || [];
  const heat = Math.max(30, Math.min(95, Number(row.heat ?? 70)));
  await q(`INSERT INTO lead_pool (cat, kw, platform, heat, source_url, title, snippet, state, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'available', now()) ON CONFLICT (source_url) DO NOTHING`, [cat, kw, row.platform, heat, row.source_url, row.title || null, row.snippet || null]);
}

// ---------- basics ----------
app.get('/healthz', (_req,res)=>res.json({ ok:true }));
app.get('/whoami', (_req,res)=>res.send('galactly-api'));
app.get('/__routes', (_req,res)=>res.json([
  { path:'/healthz', methods:['get'] },
  { path:'/__routes', methods:['get'] },
  { path:'/whoami', methods:['get'] },
  { path:'/api/v1/status', methods:['get'] },
  { path:'/api/v1/gate', methods:['post'] },
  { path:'/api/v1/leads', methods:['get'] },
  { path:'/api/v1/claim', methods:['post'] },
  { path:'/api/v1/own', methods:['post'] },
  { path:'/api/v1/events', methods:['post'] },
  { path:'/api/v1/debug/peek', methods:['get'] },
  { path:'/api/v1/admin/ingest', methods:['post'] },
  { path:'/api/v1/admin/seed-brands', methods:['post'] },
  { path:'/api/v1/find-now', methods:['post'] },
  { path:'/api/v1/ifthen', methods:['get'] }
]));
app.get('/api/v1/status', (_req,res)=>res.json({ ok:true, mode:'vendor-signals' }));

// ---------- users ----------
app.post('/api/v1/gate', async (req,res)=>{
  const userId = (req as any).userId; if(!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  const { region, email, alerts } = req.body || {};
  await q(`INSERT INTO app_user(id,region,email,alerts) VALUES ($1,$2,$3,COALESCE($4,false)) ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`, [userId, region||null, email||null, alerts===true]);
  res.json({ ok:true });
});

// ---------- events (confirm/mute etc.) ----------
app.post('/api/v1/events', async (req,res)=>{
  const userId = (req as any).userId || null;
  const { leadId, type, meta } = req.body || {};
  if (!leadId || !type) return res.status(400).json({ ok:false, error:'bad request' });
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta || {}]);

  if (String(type) === 'confirm_ad' && userId) {
    const host = (()=>{ try{ return new URL(meta?.url || '').hostname; }catch{ return meta?.domain || null; } })();
    const platform = String(meta?.platform || 'adlib_free').toLowerCase();
    if (host) {
      await q(`UPDATE app_user SET user_prefs = jsonb_set(COALESCE(user_prefs,'{}'::jsonb), '{confirmedProofs}', (COALESCE(user_prefs->'confirmedProofs','[]'::jsonb) || to_jsonb(json_build_object('host',$2,'platform',$3,'ts',now())))) WHERE id=$1`, [userId, host, platform]);
      await q(`UPDATE lead_pool SET fit_user = LEAST(100, COALESCE(fit_user,60) + 5) WHERE id=$1`, [leadId]);
    }
  }
  if (String(type) === 'mute_domain' && userId && meta?.domain) {
    await q(`UPDATE app_user SET user_prefs = jsonb_set(COALESCE(user_prefs,'{}'::jsonb), '{muteDomains}', (COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text))) WHERE id=$1`, [userId, String(meta.domain)]);
  }
  res.json({ ok:true });
});

// ---------- leads feed (ranked + interleaved) ----------
app.get('/api/v1/leads', async (req,res)=>{
  const userId = (req as any).userId || null;
  const r = await q(`SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at FROM lead_pool WHERE state='available' ORDER BY created_at DESC LIMIT 60`);
  let leads = r.rows as any[];
  const wRow = await q<{ weights:any }>(`SELECT weights FROM model_state WHERE segment='global'`);
  const weights: Weights = (wRow.rows[0]?.weights as Weights) || { coeffs:{recency:0.4,platform:1.0,domain:0.5,intent:0.6,histCtr:0.3,userFit:1.0}, platforms:{}, badDomains:[] } as any;
  let prefs: UserPrefs | undefined; if (userId) { const pr = await q<{ user_prefs:any }>('SELECT user_prefs FROM app_user WHERE id=$1', [userId]); prefs = pr.rows[0]?.user_prefs || undefined; }

  leads = leads.map(L => ({ ...L, _score: computeScore(L, weights, prefs) }))
               .sort((a,b)=>b._score-a._score);
  leads = interleaveByPlatform(leads).slice(0, 20);

  if (!leads.length) {
    leads = [{ id:-1, cat:'demo', kw:['packaging'], platform:'demo', fit_user:60, heat:80, source_url:'https://example.com/proof', title:'Demo HOT lead (signals warming up)', snippet:'This disappears once ingest runs.', ttl: nowPlusMinutes(60).toISOString(), state:'available', created_at: new Date().toISOString() }];
  }
  res.json({ ok:true, leads: leads.map(({_score, ...rest})=>rest), nextRefreshSec: 20 });
});

// ---------- claim / own ----------
app.post('/api/v1/claim', async (req,res)=>{
  const userId = (req as any).userId; const { leadId } = req.body || {};
  if (!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  if (!leadId || leadId < 0) return res.json({ ok:true, demo:true, reservedForSec:120, reveal:null });
  const windowId = randomUUID(); const reservedUntil = nowPlusMinutes(2).toISOString();
  const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now() WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
  if (r.rowCount === 0) return res.status(409).json({ ok:false, error:'not available' });
  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until) VALUES ($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);
  res.json({ ok:true, windowId, reservedForSec:120, reveal:{} });
});

app.post('/api/v1/own', async (req,res)=>{
  const userId = (req as any).userId; const { windowId } = req.body || {};
  if (!userId || !windowId) return res.status(400).json({ ok:false, error:'bad request' });
  const r = await q<{ lead_id:number }>(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
  const leadId = r.rows[0]?.lead_id; if (!leadId) return res.status(410).json({ ok:false, error:'window expired' });
  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);
  res.json({ ok:true });
});

// ---------- debug ----------
app.get('/api/v1/debug/peek', async (_req,res)=>{
  try{
    const la = await q(`SELECT COUNT(*) FROM lead_pool WHERE state='available'`);
    const lt = await q(`SELECT COUNT(*) FROM lead_pool`);
    const cx = Object.keys(process.env).filter(k=>k.startsWith('GOOGLE_CX_') && (process.env[k]||'').length>0).length;
    res.json({ ok:true, counts:{ leads_available: Number(la.rows[0]?.count||0), leads_total: Number(lt.rows[0]?.count||0) }, env:{ GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY, GOOGLE_CX_COUNT: cx, ADLIB_FREE_META_COUNTRIES: process.env.ADLIB_FREE_META_COUNTRIES || 'US' } });
  }catch(e:any){ res.status(500).json({ ok:false, error:String(e?.message||e) }); }
});

// ---------- If‑Then rules (static v1 surfaced in modal) ----------
import ifthen from './ifthen_rules.json';
app.get('/api/v1/ifthen', (_req,res)=> res.json({ ok:true, rules: ifthen }));

// ---------- find‑now (on‑demand flow) ----------
app.post('/api/v1/find-now', async (req,res)=>{
  const started = Date.now();
  const body = req.body || {};
  const buyersRaw: string[] = Array.isArray(body.buyers) ? body.buyers : [];
  const industries: string[] = Array.isArray(body.industries) ? body.industries : [];
  const regions: string[] = Array.isArray(body.regions) ? body.regions : [];

  // If vendorDomain provided, derive buyers (optional helper)
  if ((!buyersRaw || !buyersRaw.length) && body.vendorDomain) {
    try { const icp = await deriveBuyersFromVendorSite(body.vendorDomain); buyersRaw.push(...(icp.buyers || []).map((b:any)=>b.domain)); } catch {}
  }

  const seedDomains = buyersRaw.map(normHost).filter(Boolean);
  const advertisers = await findAdvertisersFree({ industries, regions, seedDomains }).catch(()=>[]);
  const advDomains = advertisers.map(a=>normHost(a.domain)).filter(Boolean);
  const domains = Array.from(new Set([...seedDomains, ...advDomains])).slice(0, Number(process.env.FIND_MAX_DOMAINS || 40));

  let created = 0, checked = 0; const seen = new Set<string>();
  for (const host of domains) {
    // keep ad proofs (verifiable)
    for (const a of advertisers.filter(x=>normHost(x.domain)===host)) {
      if (a.proofUrl && !seen.has(a.proofUrl)) { await insertLead({ platform:'adlib_free', source_url:a.proofUrl, title:`${host} — ad transparency search`, snippet:`Source: ${a.source} • Last seen: ${a.lastSeen||'recent'}`, kw:['ads','buyer','spend'], cat:'demand', heat:70 }); seen.add(a.proofUrl); created++; }
    }
    // intake/procurement
    try { const intake = await scanBrandIntake(host); for (const h of intake) { if (!seen.has(h.url)) { await insertLead({ platform:'brandintake', source_url:h.url, title:h.title || `${host} — Supplier/Procurement`, snippet:h.snippet || host, kw:['procurement','supplier','packaging'], cat:'procurement', heat:82 }); seen.add(h.url); created++; } } } catch {}
    // product PDP
    try { const pdp = await scanPDP(host); for (const p of pdp) { if (!seen.has(p.url)) { await insertLead({ platform: p.type || 'pdp', source_url:p.url, title:p.title || `${host} product`, snippet:p.snippet || '', kw:['case','pack','dims'], cat:'product', heat: p.type==='restock_post'?78:68 }); seen.add(p.url); created++; } } } catch {}
    checked++;
  }
  res.json({ ok:true, checked, created, advertisers: advertisers.length, tookMs: Date.now()-started });
});
// --- lightweight status / gating / knobs ---
app.get('/api/v1/status', (req, res) => {
  // anonymous-safe fingerprint to seed front-end timers/animations
  const userId = (req as any)?.userId || 'anon';
  const fp = [...userId].reduce((a, c) => a + c.charCodeAt(0), 0) % 1000;

  // free plan defaults (you can lift these via env in the future)
  const plan = 'free';
  const revealsDaily = 2;          // number of deep reveals/day
  const previewOnlyOnFire = true;  // show “On Fire” as blurred teaser on free
  const cooldownSec = 0;           // per-request UI cooldown if you want it
  const priority = 1;              // match-making priority (1 low, 5 high)

  // transparent knobs for client ranking (used in the feed UI)
  const multipliers = {
    freshness: 1.0,  // how hard to weight recency on this plan/user
    fit: 1.0,        // per-user vault boost (confirmations, mutes, prefs)
    proof: 0.8       // how much to boost leads with verified proof
  };

  res.json({ ok: true, plan, fp, revealsDaily, previewOnlyOnFire, cooldownSec, priority, multipliers });
});


migrate().then(()=> app.listen(PORT, '0.0.0.0', ()=> console.log(`galactly-api listening on :${PORT}`)));
