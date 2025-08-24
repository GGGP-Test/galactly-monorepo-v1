// @ts-nocheck
res.json({ ok: true });
});


app.post('/api/v1/arrange-more', async (req, res) => {
const uid = userId(req);
const { leadId } = req.body || {};
const lead = await db.prepare(`SELECT cat,kw,platform FROM lead_pool WHERE id=?`).get(leadId) as any;
if (lead) {
const now = Date.now();
const prefs = (await db.prepare(`SELECT cat_weights_json,kw_weights_json,plat_weights_json FROM user_prefs WHERE user_id=?`).get(uid) as any) || { cat_weights_json: '{}', kw_weights_json: '{}', plat_weights_json: '{}' };
const cat = JSON.parse(prefs.cat_weights_json || '{}');
const kw = JSON.parse(prefs.kw_weights_json || '{}');
const plat = JSON.parse(prefs.plat_weights_json || '{}');
cat[lead.cat] = (cat[lead.cat] || 0) + 0.4; kw[lead.kw] = (kw[lead.kw] || 0) + 0.6; plat[lead.platform] = (plat[lead.platform] || 0) + 0.3;
await db.prepare(`UPDATE user_prefs SET cat_weights_json=?, kw_weights_json=?, plat_weights_json=?, updated_at=? WHERE user_id=?`).run(JSON.stringify(cat), JSON.stringify(kw), JSON.stringify(plat), now, uid);
await db.prepare(`UPDATE users SET fp = MIN(99, fp+1) WHERE id=?`).run(uid);
await db.prepare(`INSERT INTO claims(lead_id,user_id,action,created_at) VALUES(?,?,?,?)`).run(leadId, uid, 'arrange_more', now);
}
res.json({ ok: true });
});


app.post('/api/v1/human-check', async (req, res) => {
const uid = userId(req);
await db.prepare(`UPDATE users SET fp = MIN(99, fp+2) WHERE id=?`).run(uid);
await db.prepare(`DELETE FROM cooldowns WHERE user_id=?`).run(uid);
res.json({ ok: true, fpDelta: 2 });
});


app.post('/api/v1/alerts', async (req, res) => {
const uid = userId(req);
const { emailOn } = req.body || {};
await db.prepare(`INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`).run(uid, emailOn ? 1 : 0, Date.now(), Date.now());
await db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts', ?) WHERE id=?`).run(emailOn ? 1.1 : 1.0, uid);
res.json({ ok: true });
});


app.post('/api/v1/push/subscribe', async (req, res) => { const uid = userId(req); const sub = req.body; saveSubscription(uid, sub); res.json({ ok: true }); });


app.get('/api/v1/status', async (req, res) => {
const uid = userId(req);
const st = (await db.prepare(`SELECT fp, multipliers_json FROM users WHERE id=?`).get(uid) as any) || { fp: 50, multipliers_json: '{"verified":1.0,"alerts":1.0,"payment":1.0}' };
const m = JSON.parse(st.multipliers_json || '{}');
const priority = Math.round(st.fp * (m.verified || 1.0) * (m.alerts || 1.0) * (m.payment || 1.0) * 10) / 10;
const cd = await db.prepare(`SELECT ends_at FROM cooldowns WHERE user_id=?`).get(uid) as any;
const cooldownSec = cd ? Math.max(0, Math.ceil((cd.ends_at - Date.now()) / 1000)) : 0;
res.json({ fp: st.fp, cooldownSec, priority, multipliers: m });
});


app.post('/api/v1/expose', async (req,res)=>{
const uid = (req.headers['x-galactly-user'] as string) || 'anon';
const { company='', site='', role='', location='', moq='', leadtime='', caps='', links='', cats=[], tags=[] } = req.body||{};
await db.prepare(`
INSERT INTO supplier_profiles(user_id,company,site,role,location,moq,leadtime,caps,links,cats_json,tags_json,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET
company=excluded.company, site=excluded.site, role=excluded.role, location=excluded.location,
moq=excluded.moq, leadtime=excluded.leadtime, caps=excluded.caps, links=excluded.links,
cats_json=excluded.cats_json, tags_json=excluded.tags_json, updated_at=excluded.updated_at
`).run(uid, company, site, role, location, moq, leadtime, caps, links, JSON.stringify(cats||[]), JSON.stringify(tags||[]), Date.now());
res.json({ok:true});
});


const port = process.env.PORT || 8787;
app.listen(port, () => console.log('API up on', port));
