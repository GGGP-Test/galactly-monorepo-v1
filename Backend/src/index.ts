// @ts-nocheck
setInterval(() => {
const now = Date.now();
for (const [k, v] of seen) if (now - v > 2 * 60_000) seen.delete(k);
}, 30_000);


function hourLocal() { const d = new Date(); return d.getUTCHours(); }
function humansOnlineValue() {
const real = [...seen.values()].filter(ts => Date.now() - ts < 120_000).length;
const h = hourLocal();
const floor = h >= 7 && h <= 22 ? 1 : 2;
const pad = Math.min(5, Math.round(real * 0.1));
return Math.max(real, floor) + pad;
}
function userId(req: any) {
return (req.headers['x-galactly-user'] as string) || (req.query.userId as string) || 'anon-' + (req.ip || '');
}


// ---------- Routes ----------
app.post('/api/v1/gate', async (req, res) => {
const { industries = [], region = 'US', email = '', alerts = false } = req.body || {};
const uid = userId(req);
await upsertUser(uid, region, email);


if (email && /@/.test(email) && (region === 'US' || region === 'Canada')) {
await db.prepare(`UPDATE users SET fp = MIN(99, fp+3), verified_at=? WHERE id=?`).run(Date.now(), uid);
}
if (alerts) {
await db.prepare(
`INSERT INTO alerts(user_id,email_on,created_at,updated_at) VALUES(?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET email_on=excluded.email_on, updated_at=excluded.updated_at`
).run(uid, 1, Date.now(), Date.now());
await db.prepare(`UPDATE users SET multipliers_json=json_set(multipliers_json,'$.alerts',1.1) WHERE id=?`).run(uid);
}
return res.json({ ok: true });
});


app.get('/api/v1/leads', async (req, res) => {
const uid = userId(req);
const region = (req.query.region as string) || 'US';
const cat = (req.query.cat as string) || 'all';
const fitMin = parseInt((req.query.fit as string) || (req.query.fitMin as string) || '60', 10);
const q = ((req.query.q as string) || '').toLowerCase();


seen.set(uid, Date.now());


const where: string[] = ["state IN ('available','reserved')", 'expires_at > ?', 'region = ?'];
const params: any[] = [Date.now(), region];
if (cat !== 'all') { where.push('cat = ?'); params.push(cat); }
if (fitMin) { where.push('fit_user >= ?'); params.push(fitMin); }
if (q) {
where.push('(lower(kw) LIKE ? OR lower(cat) LIKE ? OR lower(platform) LIKE ?)');
params.push(`%${q}%`, `%${q}%`, `%${q}%`);
}


const rows = await db.prepare(
`SELECT id,cat,kw,platform,region,fit_user as fit,fit_competition as compFit,heat,
((strftime('%s','now')*1000 - generated_at)/1000) as age
FROM lead_pool
WHERE ${where.join(' AND ')}
ORDER BY generated_at DESC
LIMIT 64`
).all(...params) as SimpleLead[];


const humansOnline = humansOnlineValue();
const nextRefreshSec = 15;
let cards: SimpleLead[] = rows || [];
if (cards.length < 6) {
const need = 6 - cards.length;
const demos = makeDemoCards(need, cat);
cards = [...cards, ...demos];
}
return res.json({ leads: cards, humansOnline, nextRefreshSec });
});


// (rest of your claim/own/arrange-more/human-check/alerts/push/status/expose routes stay as-is)


// ⬇️ NEW: mount the leads router that exposes /peek and an alternate /leads aggregation
app.use('/api/v1', leadsRouter);


const port = process.env.PORT || 8787;
app.listen(port, () => console.log('API up on', port));
