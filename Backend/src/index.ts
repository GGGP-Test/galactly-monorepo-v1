// Backend/src/index.ts
import express from 'express';
import cors from 'cors';

import { mountPublic } from './routes/public';
import { mountReveal } from './api/reveal';

const app = express();

// ---------- CORS ----------
const allowList = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOpts: cors.CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (!allowList.length) return cb(null, true);
    cb(null, allowList.includes(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-galactly-user'],
  credentials: false,
  maxAge: 86400,
};

// ---------- App ----------
app.set('trust proxy', true);
app.use(cors(corsOpts));
app.use(express.json({ limit: '1mb' }));

// ---------- Health & meta ----------
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/readyz', (_req, res) => res.json({ ok: true, ready: true, time: new Date().toISOString() }));
app.get('/version', (_req, res) => res.json({ ok: true, version: process.env.APP_VERSION ?? 'dev' }));
app.get('/api/v1/config', (_req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV ?? 'development',
    devUnlimited: (process.env.DEV_UNLIMITED ?? '').toLowerCase() === 'true',
    allowList,
    version: process.env.APP_VERSION ?? 'dev',
    time: new Date().toISOString(),
  });
});

// attach a simple user id for convenience
app.use((req, _res, next) => {
  (req as any).userId = (req.header('x-galactly-user') ?? 'anon').toString();
  next();
});

// ---------- Routers ----------
mountPublic(app);       // /api/v1/public/*
mountReveal(app);       // /api/v1/reveal/*

// ---------- Fallback ----------
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// ---------- Listen ----------
const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
