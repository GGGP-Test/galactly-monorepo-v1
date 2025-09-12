// src/index.ts
// Minimal server that mounts the WebScout v0 route. No external deps.

import * as express from 'express';
import type { Request, Response } from 'express';
import mountWebscout from './routes/webscout';

const app = express();

// Basic hardening + JSON body
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Lightweight CORS (no external package)
app.use((req: Request, res: Response, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health checks
app.get('/healthz', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get('/', (_req, res) => res.type('text/plain').send('OK'));

// Mount WebScout (v0 stub already in src/routes/webscout.ts)
mountWebscout(app);

// Bind
const port = Number(process.env.PORT || 8080);
const host = '0.0.0.0';
app.listen(port, host, () => {
  // console output is fine for Northflank logs
  console.log(`[api] listening on http://${host}:${port} (PORT=${port})`);
});

// Optional export for tests (harmless at runtime)
export default app;
