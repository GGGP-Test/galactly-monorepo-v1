// src/index.ts
import express from 'express';
import cors from 'cors';

import leadsRouter from './routes/leads';
import ingestRouter from './routes/ingest';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// health + routes list (handy for the free panel)
const ROUTES: string[] = [];
function reg(method: string, path: string) { ROUTES.push(`${method} ${path}`); }

app.get('/healthz', (_req, res) => res.json({ ok: true, msg: 'healthy' }));
reg('GET', '/healthz');

app.get('/routes', (_req, res) => res.json({ ok: true, routes: ROUTES.sort() }));
reg('GET', '/routes');

// Mount API
app.use('/api', leadsRouter);
app.use('/api', ingestRouter);
reg('USE', '/api/leads/*');
reg('USE', '/api/ingest/*');

// Compat mounts the panel probes for:
function mountCompat(root = '') {
  const base = (p: string) => (root ? `/${root.replace(/^\/+|\/+$/g,'')}${p}` : p);
  // warm/hot lists
  app.get(base('/leads/warm'), leadsRouter);
  app.get(base('/leads/hot'), leadsRouter);
  // find endpoints
  app.get(base('/leads/find'), leadsRouter);
  app.get(base('/leads/find-buyers'), leadsRouter);
  app.post(base('/leads/deepen'), ingestRouter);
  app.post(base('/ingest/github'), ingestRouter);

  app.get(base('/'), (_req, res) => res.json({ ok: true, root: root || '(root)' }));
}
mountCompat('');
mountCompat('api');
mountCompat('api/v1');
mountCompat('v1');

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;