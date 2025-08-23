import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { migrate, q } from './db';
import { computeScore, type Weights, type UserPrefs } from './scoring';


const app = express();
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Headers', 'Content-Type, x-galactly-user, x-admin-token');
res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
if (req.method === 'OPTIONS') return res.sendStatus(200);
(req as any).userId = req.header('x-galactly-user') || null;
next();
});


const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';


// health for NF
app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/whoami', (_req, res) => res.send('galactly-api'));


// peek
app.get('/api/v1/debug/peek', async (_req, res) => {
try{
const total = (await q('SELECT COUNT(*) FROM lead_pool')).rows[0]?.count || 0;
const available = (await q("SELECT COUNT(*) FROM lead_pool WHERE state='available'"))
.rows[0]?.count || 0;
const cxCount = Object.keys(process.env).filter(k => k.startsWith('GOOGLE_CX_') && (process.env[k]||'').length>0).length;
res.json({ total: Number(total), available: Number(available),
env: { RSSHUB_FEEDS_FILE: !!process.env.RSSHUB_FEEDS_FILE,
FEEDS_NATIVE_FILE: !!process.env.FEEDS_NATIVE_FILE,
GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
GOOGLE_CX_COUNT: cxCount }});
}catch(e){ res.json({ ok:false, error: String(e) }); }
});


function isAdmin(req: express.Request) {
const token = (req.query.token as string) || req.header('x-admin-token') || '';
return ADMIN_TOKEN && token === ADMIN_TOKEN;
}


// live list of active CSE queries (for cross-platform ingestion)
app.get('/api/v1/admin/queries.txt', async (req, res) => {
migrate().then(()=> app.listen(PORT, '0.0.0.0', ()=> console.log(`galactly-api :${PORT}`)));
