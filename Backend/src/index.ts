import express from 'express';
import cors from 'cors';
import type { Request, Response } from 'express';
import { pool } from './db';


const app = express();
app.use(cors());
app.use(express.json());


const PORT = Number(process.env.PORT || 8787);
const HOST = '0.0.0.0';


// --- health ---
app.get('/healthz', (_req: Request, res: Response) => {
res.status(200).send('ok');
});


// --- debug ---
app.get('/api/v1/debug/peek', async (_req: Request, res: Response) => {
try {
const now = await pool.query('SELECT NOW() AS now');
res.json({
ok: true,
now: now.rows?.[0]?.now ?? null,
pg: !!now.rows,
uptime_s: Math.round(process.uptime()),
env: {
NODE_ENV: process.env.NODE_ENV || 'dev',
},
});
} catch (e) {
res.json({ ok: true, now: null, error: String(e) });
}
});


// --- leads (safe) ---
app.get('/api/v1/leads', async (req: Request, res: Response) => {
});
