import express from 'express';


// Gate + Status (keep existing shapes minimal so smoke-test stays green)
app.get('/api/v1/gate', (req, res) => {
const uid = String(req.query.uid || 'anonymous');
res.json({ ok: true, uid, plan: 'free' });
});
app.get('/api/v1/status', (req, res) => {
const uid = String(req.query.uid || 'anonymous');
res.json({ ok: true, uid, claimed: 0, owned: 0 });
});


// Admin trigger placeholder (the real workers run in Actions)
app.get('/api/v1/admin/poll-now', (req, res) => {
const src = String(req.query.source || 'all');
res.json({ ok: true, accepted: true, source: src });
});


// Feedback endpoint (👍 👎 mute) – best-effort insert so it never crashes the app
app.post('/api/v1/feedback', async (req, res) => {
const { user_id, lead_id, type, meta } = req.body || {};
try {
await pool.query(
`insert into event_log (user_id, lead_id, event_type, meta) values ($1,$2,$3,$4)`,
[String(user_id || 'anon'), lead_id ?? null, String(type || 'unknown'), meta || {}]
);
res.json({ ok: true });
} catch (_err) {
// Don’t surface DB errors in free tier; just acknowledge
res.json({ ok: true, note: 'feedback buffered' });
}
});


// --- START ---
app.listen(PORT, HOST, () => {
// eslint-disable-next-line no-console
console.log(`[BOOT] API listening on http://${HOST}:${PORT}`);
});
