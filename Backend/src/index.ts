import 'dotenv/config';
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
if (userId && leads.length) { const vals = leads.map(L => `('${userId}', ${Number(L.id)}, 'impression', now(), '{}'::jsonb)`).join(','); await q(`INSERT INTO event_log (user_id, lead_id, event_type, created_at, meta) VALUES ${vals}`); }
if (leads.length < 6) { const missing = 6 - leads.length; const demos = Array.from({ length: missing }).map((_, i) => ({ id: -(i+1), cat:'demo', kw:['packaging'], platform:'demo', fit_user:60, heat:60, source_url:'https://example.com/demo', title:'Sample Lead', snippet:'Demo card while ingest warms up', ttl: toISO(nowPlusMinutes(60)), state:'available', created_at: new Date().toISOString(), _score:0 })); leads = [...leads, ...demos]; }
res.json({ ok:true, leads: leads.map(({_score, ...rest})=>rest), nextRefreshSec });
});


app.post('/api/v1/claim', async (req, res) => {
const userId = (req as any).userId; if (!userId) return res.status(400).json({ ok: false, error: 'missing x-galactly-user' });
const { leadId } = req.body || {}; if (!leadId || leadId < 0) return res.json({ ok: true, demo:true, reservedForSec:120, reveal:null });
const windowId = randomUUID(); const reservedUntil = nowPlusMinutes(2);
const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now() WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
if (r.rowCount === 0) return res.status(409).json({ ok:false, error:'not available' });
await q(`INSERT INTO claim_window (window_id, lead_id, user_id, reserved_until) VALUES ($1,$2,$3,$4)`, [windowId, leadId, userId, reservedUntil]);
await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);
res.json({ ok:true, windowId, reservedForSec:120, reveal:{} });
});


app.post('/api/v1/own', async (req, res) => {
const userId = (req as any).userId; const { windowId } = req.body || {};
if (!userId || !windowId) return res.status(400).json({ ok:false, error:'bad request' });
const w = await q(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
const leadId = w.rows[0]?.lead_id; if (!leadId) return res.status(410).json({ ok:false, error:'window expired' });
await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);
res.json({ ok:true });
});


app.get('/api/v1/status', async (req, res) => {
const userId = (req as any).userId || 'anon'; const fp = userId.split('').reduce((a:number,c:string)=>a+c.charCodeAt(0),0)%1000;
res.json({ fp, cooldownSec:0, priority:1, multipliers:{ freshness:1.0, fit:1.0 } });
});


migrate().then(()=> app.listen(PORT, '0.0.0.0', ()=> console.log(`galactly-api listening on :${PORT}`)));
