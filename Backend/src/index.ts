// src/index.ts
import express from 'express';
import cors from 'cors';
import leads from './routes/leads';
import { ensureTables } from './shared/db';

// -------- app --------
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// health & routes list
const ROUTES: string[] = [];
const reg = (m: string, p: string) => ROUTES.push(`${m} ${p}`);

app.get('/healthz', (_req, res) => res.json({ ok: true, msg: 'healthy' })); reg('GET','/healthz');
app.get('/routes',  (_req, res) => res.json({ ok: true, routes: ROUTES.sort() })); reg('GET','/routes');

// API
app.use('/api', leads); reg('USE','/api');

// Back-compat roots the panel sometimes touches
app.get('/', (_req, res) => res.json({ ok: true })); reg('GET','/');
app.get('/api/v1/healthz', (_req, res)=>res.json({ok:true})); reg('GET','/api/v1/healthz');

// -------- start --------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, async () => {
  // create tables if Postgres is connected (no-ops if not)
  await ensureTables();
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});