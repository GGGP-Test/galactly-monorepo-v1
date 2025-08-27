import 'dotenv/config';
import express from 'express';
import { migrate, q } from './db';
import { computeScore, type Weights, type UserPrefs } from './scoring';
import { randomUUID } from 'crypto';
import { nowPlusMinutes } from './util';
import { runIngest } from './ingest';
import { enrichLead } from './connectors/enrich';


const app = express();
app.use(express.json({ limit: '200kb' }));


// CORS for GH Pages / anywhere
app.use((req, res, next) => {
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
if (req.method === 'OPTIONS') return res.sendStatus(200); next();
});


const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
app.use((req, _res, next) => { (req as any).userId = req.header('x-galactly-user') || null; next(); });


app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));



app.get('/api/v1/debug/peek', async (_req, res) => {
try{
const total = (await q('SELECT COUNT(*) FROM lead_pool')).rows[0]?.count || 0;
const available = (await q("SELECT COUNT(*) FROM lead_pool WHERE state='available'")) .rows[0]?.count || 0;
const cxCount = Object.keys(process.env).filter(k => k.startsWith('GOOGLE_CX_') && (process.env[k]||'').length>0).length;
res.json({ total: Number(total), available: Number(available), env: { GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY, GOOGLE_CX_COUNT: cxCount } });
}catch(e){ res.json({ ok:false, error: String(e) }); }
});


function isAdmin(req: express.Request) { const token = (req.query.token as string) || req.header('x-admin-token') || ''; return ADMIN_TOKEN && token === ADMIN_TOKEN; }


app.get('/api/v1/admin/poll-now', async (req, res) => {
if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
const source = (req.query.source as any) || 'all';
const result = await runIngest(source);
res.json({ ok: true, started: true, source, ...result });
});


app.post('/api/v1/enrich-one', async (req, res) => {
if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
const id = Number((req.query.id as string) || req.body?.id); if (!id || Number.isNaN(id)) return res.status(400).json({ ok: false, error: 'bad id' });
const result = await enrichLead(id); res.json(result);
});


app.post('/api/v1/events', async (req, res) => {
const userId = (req as any).userId || null; const { leadId, type, meta } = req.body || {};
if (!leadId || !type) return res.status(400).json({ ok: false, error: 'bad request' });
await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,$3,$4)`, [userId, leadId, String(type), meta || {}]);
res.json({ ok: true });
});


app.post('/api/v1/gate', async (req, res) => {
const userId = (req as any).userId; if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
const { region, email, alerts } = req.body || {};
await q(`INSERT INTO app_user (id, region, email, alerts) VALUES ($1,$2,$3,COALESCE($4,false)) ON CONFLICT (id) DO UPDATE SET region=EXCLUDED.region, email=EXCLUDED.email, alerts=EXCLUDED.alerts, updated_at=now()`, [userId, region || null, email || null, alerts === true]);
res.json({ ok: true });
  });


app.get('/api/v1/leads', async (req, res) => {
const userId = (req as any).userId || null; const limit = 40;
const r = await q(`SELECT id, cat, kw, platform, fit_user, heat, source_url, title, snippet, ttl, state, created_at FROM lead_pool WHERE state='available' ORDER BY created_at DESC LIMIT $1`, [limit]);
let leads = r.rows as any[];
const wRow = await q<{ weights: any }>(`SELECT weights FROM model_state WHERE segment='global'`);
const weights: Weights = (wRow.rows[0]?.weights as Weights) || { coeffs:{recency:0.4,platform:1.0,domain:0.5,intent:0.6,histCtr:0.3,userFit:1.0}, platforms:{}, badDomains:[] } as any;
let prefs: UserPrefs | undefined; if (userId) { const pr = await q<{ user_prefs: any }>('SELECT user_prefs FROM app_user WHERE id=$1', [userId]); prefs = pr.rows[0]?.user_prefs || undefined; }
leads = leads.map(L => ({ ...L, _score: computeScore(L, weights, prefs) })).sort((a,b)=>b._score-a._score).slice(0,20);
const nextRefreshSec = 15;
res.json({ ok:true, leads: leads.map(({_score, ...rest})=>rest), nextRefreshSec });
});


app.post('/api/v1/claim', async (req, res) => {
const userId = (req as any).userId; if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
const { leadId } = req.body || {}; if (!leadId || leadId < 0) return res.json({ ok: true, demo:true, reservedForSec:120, reveal:null });
const windowId = randomUUID(); const reservedUntil = nowPlusMinutes(2);
const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now() WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
if (r.rowCount === 0) return res.status(409).json({ ok:false, error:'not available' });
await q(`INSERT INTO claim_window (window_id, lead_id, user_id, reserved_until) VALUES ($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
res.json({ ok:true, windowId, reservedForSec:120, reveal:{} });
});


app.post('/api/v1/own', async (req, res) => {
const userId = (req as any).userId; const { windowId } = req.body || {};
if (!userId || !windowId) return res.status(400).json({ ok:false, error:'bad request' });
const w = await q(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
const leadId = w.rows[0]?.lead_id; if (!leadId) return res.status(410).json({ ok:false, error:'window expired' });
await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
res.json({ ok:true });
});


migrate().then(()=> app.listen(PORT, '0.0.0.0', ()=> console.log(`galactly-api listening on :${PORT}`)));
