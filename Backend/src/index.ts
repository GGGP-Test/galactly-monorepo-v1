import express from 'express';
import cors from 'cors';
import { mountPublic } from './routes/public';
import { mountReveal } from './api/reveal';
import { mountLeads } from './routes/leads';

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// basic meta
app.get('/healthz', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);
app.get('/readyz', (_req, res) =>
  res.json({ ok: true, ready: true, time: new Date().toISOString() })
);
app.get('/version', (_req, res) =>
  res.json({ ok: true, version: process.env.VERSION || 'dev' })
);
app.get('/api/v1/config', (_req, res) =>
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'production',
    devUnlimited: false,
    allowList: [],
    version: process.env.VERSION || 'dev',
    time: new Date().toISOString()
  })
);

// routes
mountPublic(app);
mountLeads(app);
mountReveal(app);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Backend listening on :${port}`));
