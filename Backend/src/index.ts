// Backend/src/index.ts
import express from 'express';
import cors from 'cors';
import { mountPublic } from './routes/public';
import { mountReveal } from './api/reveal';

const app = express();

// hardening + basics
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// health
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
app.get('/readyz', (_req, res) => {
  res.json({ ok: true, ready: true, time: new Date().toISOString() });
});
app.get('/version', (_req, res) => {
  res.json({ ok: true, version: process.env.VERSION || 'dev' });
});

// mount v1 routes
mountPublic(app);
mountReveal(app);

// boot
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api listening on :${PORT}`);
});
