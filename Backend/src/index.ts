import express from 'express';
import cors from 'cors';
import { attachUser } from './auth';
import { mountPublic } from './routes/public';
import { mountLeads } from './routes/leads';
import { mountReveal } from './api/reveal';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health/version
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/readyz', (_req, res) => res.json({ ok: true, ready: true, time: new Date().toISOString() }));
app.get('/version', (_req, res) => res.json({ ok: true, version: process.env.VERSION || 'dev' }));

// all API routes get a userId
app.use('/api', attachUser());

// v1 routes
mountPublic(app);
mountLeads(app);
mountReveal(app);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`api listening on :${PORT}`));
