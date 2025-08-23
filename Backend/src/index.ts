import 'dotenv/config';
const reservedUntil = nowPlusMinutes(2);


const r = await q(`UPDATE lead_pool SET state='reserved', reserved_by=$1, reserved_at=now()
WHERE id=$2 AND state='available' RETURNING id`, [userId, leadId]);
if (r.rowCount === 0) return res.status(409).json({ ok: false, error: 'not available' });


await q(`INSERT INTO claim_window (window_id, lead_id, user_id, reserved_until) VALUES ($1,$2,$3,$4)`,
[windowId, leadId, userId, reservedUntil]);
await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,'claim','{}')`, [userId, leadId]);


res.json({ ok: true, windowId, reservedForSec: 120, reveal: { } });
});


// Own lead (logs event)
app.post('/api/v1/own', async (req, res) => {
const userId = (req as any).userId;
const { windowId } = req.body || {};
if (!userId || !windowId) return res.status(400).json({ ok: false, error: 'bad request' });
const w = await q(`SELECT lead_id FROM claim_window WHERE window_id=$1 AND user_id=$2 AND reserved_until>now()`, [windowId, userId]);
const leadId = w.rows[0]?.lead_id;
if (!leadId) return res.status(410).json({ ok: false, error: 'window expired' });


await q(`UPDATE lead_pool SET state='owned', owned_by=$1, owned_at=now() WHERE id=$2`, [userId, leadId]);
await q(`INSERT INTO event_log (user_id, lead_id, event_type, meta) VALUES ($1,$2,'own','{}')`, [userId, leadId]);
res.json({ ok: true });
});


// Status (unchanged lightweight)
app.get('/api/v1/status', async (req, res) => {
const userId = (req as any).userId || 'anon';
const fp = userId.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 1000;
res.json({ fp, cooldownSec: 0, priority: 1, multipliers: { freshness: 1.0, fit: 1.0 } });
});


migrate().then(() => {
app.listen(PORT, '0.0.0.0', () => console.log(`galactly-api listening on :${PORT}`));
});
