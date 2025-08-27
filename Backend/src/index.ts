import 'dotenv/config';
import express from 'express';
import { migrate, q } from './db';
import { intentScore } from './scoring';


const app = express();
app.use(express.json({ limit:'200kb' }));


// CORS for GH Pages or anywhere
app.use((req,res,next)=>{ res.header('Access-Control-Allow-Origin','*'); res.header('Access-Control-Allow-Headers','Content-Type, x-admin-token, x-galactly-user'); res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); if(req.method==='OPTIONS') return res.sendStatus(200); next(); });


const PORT = Number(process.env.PORT||8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN||'';


app.get('/healthz', (_req,res)=>res.json({ ok:true }));


app.get('/api/v1/debug/peek', async (_req,res)=>{
const total = Number((await q('SELECT COUNT(*) FROM lead_pool')).rows[0]?.count||0);
res.json({ total, env: { hasDB: !!process.env.DATABASE_URL } });
});


function isAdmin(req: express.Request){ const t = (req.query.token as string)||req.header('x-admin-token')||''; return ADMIN_TOKEN && t===ADMIN_TOKEN; }


import { runIngest } from './ingest';
app.get('/api/v1/admin/poll-now', async (req,res)=>{
if(!isAdmin(req)) return res.status(401).json({ ok:false, error:'unauthorized' });
const source = String(req.query.source||'all');
const r = await runIngest(source);
res.json({ ok:true, ...r });
});


app.get('/api/v1/leads', async (_req,res)=>{
const r = await q('SELECT id, platform, source_url, title, snippet, created_at FROM lead_pool WHERE state=\'available\' ORDER BY created_at DESC LIMIT 20');
const items = r.rows.map((L:any)=>({ ...L, intent:intentScore(L.title,L.snippet) }));
if(items.length===0){ return res.json({ ok:true, leads:[], nextRefreshSec:15 }); }
res.json({ ok:true, leads: items, nextRefreshSec: 15 });
  });


migrate().then(()=> app.listen(PORT,'0.0.0.0',()=>console.log('galactly listening on :'+PORT)));
