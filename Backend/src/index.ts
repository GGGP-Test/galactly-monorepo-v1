// src/index.ts
import express from 'express';
import cors from 'cors';

import leadsRouter from './routes/leads';
import ingestRouter from './routes/ingest';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// health + simple route list
const ROUTES: string[] = [];
function reg(method: string, path: string) { ROUTES.push(`${method} ${path}`); }

app.get('/healthz', (_req, res) => res.json({ ok: true, msg: 'healthy' }));
reg('GET', '/healthz');

app.get('/routes', (_req, res) => res.json({ ok: true, routes: ROUTES.sort() }));
reg('GET', '/routes');

// Mount everything under /api (the panel calls /api/*)
app.use('/api', leadsRouter);
app.use('/api', ingestRouter);
reg('USE', '/api/*');

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;