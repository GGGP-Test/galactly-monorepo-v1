import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { migrate, q } from './db';
import { computeScore, type Weights, type UserPrefs } from './scoring';
import { scanReviews } from './connectors/reviews';
import { findAdvertisersFree } from './connectors/adlib_free';
import { scanPDP } from './connectors/pdp';
import { deriveBuyersFromVendorSite } from './connectors/derivebuyersfromvendorsite';
import { mountStripeWebhook, mountStripeApi } from './stripe';

const app = express();

/* ---------- CORS (allow static frontends) ---------- */
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers','Content-Type, x-galactly-user, x-admin-token');
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ---------- Attach webhook BEFORE json parser ---------- */
mountStripeWebhook(app);

/* ---------- JSON body parser ---------- */
app.use(express.json({ limit: '300kb' }));

const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const BRANDS_FILE = process.env.BRANDS_FILE || '';

/* ---------- attach pseudo user id ---------- */
app.use((req,_res,next)=>{ (req as any).userId = req.header('x-galactly-user') || null; next(); });

/* ---------- utils ---------- */
function isAdmin(req: express.Request){ const tok=req.header('x-admin-token')||''; return ADMIN_TOKEN && tok===ADMIN_TOKEN; }
async function safe<T>(p: Promise<T>): Promise<T|null>{ try{return await p;}catch{return null;} }

/* ---------- healthz & routes ---------- */
app.get('/api/v1/healthz', async (_req,res)=>{ try{ const ok=await q('SELECT 1 as ok'); res.json({ ok: ok.rows?.[0]?.ok===1 }); }catch{ res.status(500).json({ ok:false }); } });
app.get('/__routes', (_req,res)=> res.json([
  { path:'/api/v1/healthz', methods:['get'] },
  { path:'/api/v1/status', methods:['get'] },
  { path:'/api/v1/plan', methods:['get'] },
  { path:'/api/v1/gate', methods:['post'] },
  { path:'/api/v1/leads', methods:['get'] },
  { path:'/api/v1/claim', methods:['post'] },
  { path:'/api/v1/own', methods:['post'] },
  { path:'/api/v1/events', methods:['post'] },
  { path:'/api/v1/admin/seed-brands', methods:['post'] },
  { path:'/api/v1/admin/ingest', methods:['post'] },
  { path:'/api/v1/find-now', methods:['post'] },
  { path:'/api/v1/reveal', methods:['post'] },
  { path:'/api/v1/progress.sse', methods:['get'] },
  { path:'/presence/online', methods:['get'] },
  { path:'/presence/beat', methods:['post'] },
  { path:'/api/v1/presence/online', methods:['get'] },
  { path:'/api/v1/presence/beat', methods:['post'] },
  { path:'/api/v1/lead-viewers', methods:['get','post'] },
  { path:'/api/v1/vault', methods:['get','post'] },
  { path:'/api/v1/checkout', methods:['post'] },
  { path:'/api/v1/stripe/webhook', methods:['post (raw)'] },
]));

/* ---------- quotas ---------- */
type Quota = { date:string; findsUsed:number; revealsUsed:number };
const TODAY = ()=> new Date().toISOString().slice(0,10);
async function getQuota(userId:string): Promise<Quota>{
  const r = await q<{user_prefs:any}>('SELECT user_prefs FROM app_user WHERE id=$1',[userId]);
  const prefs = r.rows[0]?.user_prefs || {};
  const qn = prefs.quota || {};
  const today = TODAY();
  if (qn.date !== today) return { date: today, findsUsed: 0, revealsUsed: 0 };
  return { date: String(qn.date), findsUsed: Number(qn.findsUsed||0), revealsUsed: Number(qn.revealsUsed||0) };
}
async function saveQuota(userId:string, qn:Quota){
  await q(`UPDATE app_user
             SET user_prefs = jsonb_set(COALESCE(user_prefs,'{}'::jsonb), '{quota}', to_jsonb($2::jsonb)),
                 updated_at = now()
           WHERE id=$1`, [userId, qn as any]);
}
function resetAtUtc(dateStr:string){ const d=new Date(dateStr+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString(); }

/* ---------- presence (in-memory) ---------- */
type Role = 'supplier'|'distributor'|'buyer'|undefined;
const PRESENCE_TTL_MS = 30_000;
const online: Record<string,{ts:number,role?:Role}> = {};
const leadViewers: Record<string, Set<string>> = Object.create(null);

app.post('/api/v1/presence/beat', (req,res)=>{ const id=(req as any).userId || randomUUID(); const role=(req.body&&req.body.role as Role)||undefined; online[id]={ts:Date.now(), role}; res.json({ok:true}); });
app.post('/presence/beat', (req,res)=>{ const id=(req as any).userId || randomUUID(); const role=(req.body&&req.body.role as Role)||undefined; online[id]={ts:Date.now(), role}; res.json({ok:true}); });

function presenceCounts(){ const now=Date.now(); let total=0,sup=0,dist=0,buy=0;
  for(const [uid,rec] of Object.entries(online)){ if(!rec || rec.ts+PRESENCE_TTL_MS<now){ delete online[uid]; continue; } total++; if(rec.role==='supplier') sup++; else if(rec.role==='distributor') dist++; else if(rec.role==='buyer') buy++; }
  return { total, suppliers: sup, distributors: dist, buyers: buy };
}
app.get('/api/v1/presence/online', (_req,res)=> res.json(presenceCounts()));
app.get('/presence/online', (_req,res)=> res.json(presenceCounts()));

app.get('/api/v1/lead-viewers', (req,res)=>{ const leadId=String(req.query.leadId||''); const counts=presenceCounts();
  if(!leadId) return res.json({ ok:true, others: Math.round(counts.total*0.08), competitors: Math.max(0, counts.suppliers+counts.distributors-1) });
  const set=leadViewers[leadId]; const others=set? Math.max(0,set.size-1): Math.round(counts.total*0.06);
  const competitors = Math.max(0, Math.min(others, counts.suppliers + counts.distributors - 1));
  res.json({ ok:true, others, competitors });
});
app.post('/api/v1/lead-viewers', (req,res)=>{ const userId=(req as any).userId || randomUUID(); const { leadId } = req.body||{}; if(!leadId) return res.status(400).json({ok:false,error:'missing leadId'}); if(!leadViewers[leadId]) leadViewers[leadId]=new Set(); leadViewers[leadId].add(userId); res.json({ok:true}); });

/* ---------- gate/status/plan ---------- */
app.post('/api/v1/gate', async (req,res)=>{
  const userId=(req as any).userId; if(!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  const { region, email, alerts } = req.body||{};
  await q(`INSERT INTO app_user(id, region, email, alerts)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET
             region=COALESCE(EXCLUDED.region, app_user.region),
             email=COALESCE(EXCLUDED.email, app_user.email),
             alerts=COALESCE(EXCLUDED.alerts, app_user.alerts),
             updated_at=now()`,
    [userId, region||null, email||null, !!alerts]);
  const quota = await getQuota(userId);
  res.json({ ok:true, userId, nextResetAt: resetAtUtc(quota.date), free:{ finds:2, reveals:2 } });
});
app.get('/api/v1/status', async (req,res)=>{ const userId=(req as any).userId||null;
  let findsLeft=2, revealsLeft=2;
  if(userId){ const qn=await getQuota(userId); findsLeft=Math.max(0,2-qn.findsUsed); revealsLeft=Math.max(0,2-qn.revealsUsed); }
  res.json({ ok:true, findsLeft, revealsLeft });
});
app.get('/api/v1/plan', async (req,res)=>{
  const userId=(req as any).userId||null;
  if(!userId) return res.json({ ok:true, plan:'free' });
  const r = await q<{ user_prefs:any }>('SELECT user_prefs FROM app_user WHERE id=$1',[userId]);
  const plan = r.rows[0]?.user_prefs?.plan || 'free';
  res.json({ ok:true, plan });
});

/* ---------- leads ---------- */
app.get('/api/v1/leads', async (req,res)=>{
  const userId=(req as any).userId||null;
  const r = await q(`SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at
                     FROM lead_pool WHERE state='available' ORDER BY created_at DESC LIMIT 40`);
  let leads:any[] = r.rows;

  const wRow = await q<{weights:any}>(`SELECT weights FROM model_state WHERE segment='global'`);
  const weights: Weights = (wRow.rows[0]?.weights as Weights) || ({ coeffs:{recency:0.4,platform:1.0,domain:0.5,intent:0.6,histCtr:0.3,userFit:1.0}, platforms:{}, badDomains:[] } as any);

  let prefs: UserPrefs|undefined;
  if (userId){ const pr = await q<{user_prefs:any}>('SELECT user_prefs FROM app_user WHERE id=$1',[userId]); prefs = pr.rows[0]?.user_prefs || undefined; }

  leads = leads.map(L=>({ ...L, _score: computeScore(L, weights, prefs) }))
               .sort((a,b)=> b._score - a._score)
               .slice(0,20);

  if(!leads.length){
    leads = [
      { id:-1, cat:'Demand', kw:['promo'], platform:'adlib', fit_user:1, heat:68, source_url:'https://example.com/promo', title:'D2C beverage promo cadence ↑', snippet:'Weekly cadence indicates stable corrugate/film usage', ttl:null, state:'available', created_at:new Date().toISOString() },
      { id:-2, cat:'Procurement', kw:['forms'], platform:'brandintake', fit_user:1, heat:74, source_url:'https://example.com/forms', title:'Procurement intake updated', snippet:'Packaging categories changed', ttl:null, state:'available', created_at:new Date().toISOString() },
    ];
  }

  res.json({ ok:true, leads: leads.map(({_score,...rest})=>rest), nextRefreshSec:15 });
});

/* ---------- claim / own ---------- */
app.post('/api/v1/claim', async (req,res)=>{
  const userId=(req as any).userId;
  const { leadId } = req.body||{};
  if(!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  if(!leadId || leadId<0) return res.json({ ok:true, demo:true, reservedForSec:120, reveal:null });

  const windowId = randomUUID();
  const reservedUntil = new Date(Date.now()+2*60*1000).toISOString();
  const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now() WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
  if(r.rowCount===0) return res.status(409).json({ ok:false, error:'not available' });
  await q(`INSERT INTO claim_window(window_id, lead_id, user_id, reserved_until) VALUES ($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
  res.json({ ok:true, windowId, reservedUntil });
});
app.post('/api/v1/own', async (req,res)=>{
  const userId=(req as any).userId; const { windowId } = req.body||{};
  if(!userId || !windowId) return res.status(400).json({ ok:false, error:'bad request' });
  const r = await q<{lead_id:number}>(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
  const leadId = r.rows[0]?.lead_id; if(!leadId) return res.status(409).json({ ok:false, error:'expired' });
  await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
  res.json({ ok:true, leadId });
});

/* ---------- events ---------- */
app.post('/api/v1/events', async (req,res)=>{
  const userId=(req as any).userId||null; const { leadId, type, meta } = req.body||{};
  if(!leadId || !type) return res.status(400).json({ ok:false, error:'bad request' });
  await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta||{}]);
  if(String(type)==='mute_domain' && userId && meta?.domain){
    await q(`UPDATE app_user
               SET user_prefs = jsonb_set(
                   COALESCE(user_prefs,'{}'::jsonb),
                   '{muteDomains}',
                   COALESCE(user_prefs->'muteDomains','[]'::jsonb) || to_jsonb($2::text)
                 )
             WHERE id=$1`, [userId, String(meta.domain)]);
  }
  res.json({ ok:true });
});

/* ---------- vault ---------- */
app.get('/api/v1/vault', async (req,res)=>{
  const userId=(req as any).userId; if(!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  const u = await q<{email:string|null,user_prefs:any,region:string|null}>('SELECT email, user_prefs, region FROM app_user WHERE id=$1',[userId]);
  const prefs = u.rows[0]?.user_prefs || {};
  const profile = { email: u.rows[0]?.email||null, role: prefs.role||null, region: u.rows[0]?.region||null, plan: (prefs.plan||'free') };
  const qn = prefs.quota || {};
  const quota = { date: String(qn.date||TODAY()), findsUsed: Number(qn.findsUsed||0), revealsUsed: Number(qn.revealsUsed||0) };
  const traits = prefs.traits || { vendorDomain: prefs.vendorDomain||null, industries: prefs.industries||[], regions: prefs.regions||[], buyers: prefs.buyers||[], notes: prefs.notes||null };
  const capabilities = { connectors: prefs.connectors||['adlib','reviews','pdp'], pro: profile.plan==='pro' };

  const ownedRows = await q(`SELECT id, title, source_url, cat, owned_at FROM lead_pool WHERE owned_by=$1 ORDER BY owned_at DESC LIMIT 200`, [userId]);
  const recentRows = await q(`SELECT id, title, source_url, cat, created_at FROM lead_pool WHERE state='available' ORDER BY created_at DESC LIMIT 50`);

  res.json({ ok:true, profile, quota, traits, capabilities, leads:{ owned: ownedRows.rows, recent: recentRows.rows, mutedDomains: (prefs.muteDomains||[]), confirmedProofs: (prefs.confirmedProofs||[]) } });
});
app.post('/api/v1/vault', async (req,res)=>{
  const userId=(req as any).userId; if(!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
  const up = req.body||{};
  const allowed = ['role','traits','muteDomains','confirmedProofs','plan','connectors'];
  const cur = await q<{user_prefs:any}>('SELECT user_prefs FROM app_user WHERE id=$1',[userId]);
  const prefs = cur.rows[0]?.user_prefs || {};
  for(const k of allowed){ if(up[k]!==undefined) prefs[k]=up[k]; }
  await q(`UPDATE app_user SET user_prefs=$2, updated_at=now() WHERE id=$1`, [userId, JSON.stringify(prefs)]);
  res.json({ ok:true, user_prefs: prefs });
});

/* ---------- find-now ---------- */
app.post('/api/v1/find-now', async (req,res)=>{
  const userId=(req as any).userId||null;
  const body=req.body||{};
  const vendor = String(body.vendor || body.vendorDomain || body.website || '').trim();
  const buyers = String(body.buyers||'').split(',').map((s:string)=>s.trim()).filter(Boolean);
  const industries = String(body.industries||'').split(',').map((s:string)=>s.trim()).filter(Boolean);
  const regions = String(body.regions||'').split(',').map((s:string)=>s.trim()).filter(Boolean);

  if (userId){ const qn=await getQuota(userId); qn.findsUsed=Math.min(2, qn.findsUsed+1); await saveQuota(userId, qn); }

  let created=0, checked=0;
  const seenUrl = new Set<string>();
  async function insertLead(L:any){
    try{
      await q(`INSERT INTO lead_pool(cat,kw,platform,fit_user,heat,source_url,title,snippet,ttl,state,created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '3 days','available',now())
               ON CONFLICT (source_url) DO NOTHING`,
        [L.cat||null, L.kw||[], L.platform||null, 1, Math.max(50,Math.min(92,Number(L.heat||60))), L.source_url, L.title||null, L.snippet||null]);
    }catch{}
  }

  if (vendor){ const d = await safe(deriveBuyersFromVendorSite(vendor)); if(d?.domains?.length) buyers.push(...d.domains); }

  for (const host of buyers.slice(0,6)) {
    const ads = (await safe(findAdvertisersFree(host))) || [];
    for (const a of ads) {
      if (a.url && !seenUrl.has(a.url)) {
        await insertLead({ platform:'adlib', source_url:a.url, title: a.title || `${host} ad activity`, snippet: a.snippet || '', kw:['ad','burst','promo'], cat:'demand', heat:72, meta:{ domain: host } });
        seenUrl.add(a.url); created++;
      }
    }
    const pdp = (await safe(scanPDP(host))) || [];
    for (const p of pdp) {
      if (p.url && !seenUrl.has(p.url)) {
        await insertLead({ platform:'pdp', source_url:p.url, title: p.title || `${host} product`, snippet: p.snippet || '', kw:['case','pack','dims'], cat:'product', heat: p.type==='restock_post'?78:68, meta:{ domain: host } });
        seenUrl.add(p.url); created++;
      }
    }
    const revHits = (await safe(scanReviews(host))) || [];
    for (const r of revHits) {
      if (r.url && !seenUrl.has(r.url)) {
        const heatBase = 62;
        const heat = Math.max(50, Math.min(92, Math.round(heatBase + (r.severity * 20) - ((r.ratingApprox || 3.2) - 3) * 4)));
        await insertLead({ platform:r.source, source_url:r.url, title:`${host} — customer review (packaging)`, snippet:r.snippet || r.title, kw:['reviews','packaging','complaint', ...(r.terms.slice(0,3))], cat:'voice', heat, meta:{ domain: host, source: r.source, rating: r.ratingApprox, terms: r.terms } });
        seenUrl.add(r.url); created++;
      }
    }
    checked++;
  }

  res.json({ ok:true, created, checked, buyers: buyers.slice(0,6) });
});

/* ---------- reveal ---------- */
app.post('/api/v1/reveal', async (req,res)=>{
  const userId=(req as any).userId||null;
  const { leadId } = req.body||{};
  if(!leadId) return res.status(400).json({ ok:false, error:'bad request' });
  if (userId){ const qn=await getQuota(userId); qn.revealsUsed=Math.min(2, qn.revealsUsed+1); await saveQuota(userId, qn); }
  const r = await q(`SELECT id, title, source_url, cat, platform, heat FROM lead_pool WHERE id=$1`, [leadId]);
  const L = r.rows[0] || null;
  res.json({ ok:true, lead:L, why:[
      `Paid reach ≈ $${(L?.heat? L.heat*90 : 5400).toLocaleString()}/mo → steady demand`,
      `Orders → units → ${Math.max(2, Math.round((L?.heat||60)/30))} SKUs/mo → queue window next 7–14d`
    ],
    proof:{ redacted:true, path:['adlib','pdp','reviews'], ts:new Date().toISOString() } });
});

/* ---------- progress.sse ---------- */
app.get('/api/v1/progress.sse', async (req,res)=>{
  res.header('Content-Type','text/event-stream');
  res.header('Cache-Control','no-cache');
  res.header('Connection','keep-alive');
  function send(type:string,data:any){ res.write(`event: ${type}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); }
  const STEPS = [
    { id:'demand',   cap:'Demand',     label:'creative burst + reach' },
    { id:'product',  cap:'Product',    label:'SKU/restock/dims' },
    { id:'proc',     cap:'Procurement',label:'supplier portals' },
    { id:'retail',   cap:'Retail',     label:'PDP/promo cadence' },
    { id:'ops',      cap:'Ops',        label:'job posts/shift adds' },
    { id:'events',   cap:'Events',     label:'trade calendar' },
    { id:'reviews',  cap:'Reviews',    label:'packaging complaints' },
    { id:'timing',   cap:'Timing',     label:'if-then windows' },
    { id:'queue',    cap:'Queue',      label:'window forecast' },
  ];
  let i=0;
  const timer=setInterval(()=>{ if(i>=STEPS.length){ clearInterval(timer); res.write(`event: halt\ndata: {}\n\n`); return; } const S=STEPS[i++]; send('step',{ index:i, of:STEPS.length, cap:S.cap, label:S.label, id:S.id, ts:Date.now() }); }, 1800);
  const hb=setInterval(()=> send('ping',{t:Date.now()}), 15000);
  req.on('close', ()=>{ clearInterval(timer); clearInterval(hb); });
});

/* ---------- admin helpers ---------- */
app.post('/api/v1/admin/seed-brands', async (req,res)=>{
  if(!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
  if(!BRANDS_FILE || !fs.existsSync(BRANDS_FILE)) return res.json({ ok:false, error:'BRANDS_FILE missing' });
  const raw=fs.readFileSync(BRANDS_FILE,'utf8');
  const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let inserted=0, skipped=0;
  for(const line of lines){
    const parts=line.split(',').map(s=>s.trim()); const domain=(parts[0]||'').replace(/^https?:\/\//,'').replace(/\/+$/,''); if(!domain){ skipped++; continue; }
    const name=parts[1]||domain; const sector=parts[2]||null;
    try{ await q(`INSERT INTO brand(name, domain, sector) VALUES ($1,$2,$3) ON CONFLICT (domain) DO NOTHING`, [name, domain, sector]); inserted++; }catch{ skipped++; }
  }
  res.json({ ok:true, inserted, skipped, total: lines.length });
});
app.post('/api/v1/admin/ingest', async (req,res)=>{ if(!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' }); res.json({ ok:true, did:'noop' }); });

/* ---------- Stripe JSON endpoints AFTER json parser ---------- */
mountStripeApi(app);

/* ---------- start ---------- */
migrate().then(()=>{ app.listen(PORT,'0.0.0.0', ()=> console.log(`galactly-api listening on :${PORT}`)); });
