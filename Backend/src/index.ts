import express from 'express';
import cors from 'cors';
import { log } from './logger';
import presenceRouter from './routes/presence';
import registerStatusRoutes, { attachQuotaHelpers, type Ctx } from './routes/status';
import readyRouter from './routes/ready';
import metricsRouter from './routes/metrics';
import fs from 'fs';
import path from 'path';

// ---- Process-level safety ---------------------------------------------------
process.on('uncaughtException', (err) => log.error({ err }, '[fatal] uncaughtException'));
process.on('unhandledRejection', (reason) => log.error({ reason }, '[fatal] unhandledRejection'));

// ---- CORS -------------------------------------------------------------------
const allowList = (process.env.ALLOWED_ORIGINS || '')
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
  allowedHeaders: ['Content-Type', 'x-galactly-user', 'x-dev-unlim'],
  credentials: false,
  maxAge: 86400,
};

// ---- App --------------------------------------------------------------------
const app = express();
app.set('trust proxy', true);
app.use(cors(corsOpts));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/*', 'application/csv'], limit: '1mb' }));

// Request id (cheap) + user id
app.use((req, _res, next) => {
  (req as any).rid = Math.random().toString(36).slice(2);
  (req as any).userId = (req.header('x-galactly-user') || 'anon').toString();
  next();
});

// Access log (lightweight)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.info({ m:req.method, p:req.path, s:res.statusCode, ms: Date.now()-start }, 'req');
  });
  next();
});

// ---- Health/Readiness -------------------------------------------------------
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/', readyRouter);

// ---- Presence (both roots) --------------------------------------------------
app.use('/', presenceRouter);
app.use('/api/v1', presenceRouter);

// ---- Status (official under /api/v1/status) --------------------------------
const ctx: Ctx = {
  users: new Map(),
  devUnlimited: (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
};
attachQuotaHelpers(ctx);
registerStatusRoutes(app, ctx);

// ---- Metrics ----------------------------------------------------------------
app.use('/', metricsRouter);

// ---- Optional mounts: only if files exist (so we never break green) --------
function mountIfExists(rel: string, mount: (m: any) => void) {
  const full = path.join(__dirname, rel);
  if (fs.existsSync(full) || fs.existsSync(full + '.js')) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(full);
    mount(mod);
    log.info({ rel }, 'mounted optional module');
  } else {
    log.info({ rel }, 'optional module not present, skipping');
  }
}

// Example: if you have api/reveal.ts compiled to dist/api/reveal.js
mountIfExists('./api/reveal', (m) => m?.mountReveal?.(app));

// Add more of your optional routes here later:
// mountIfExists('./routes/ai', (m) => m?.default?.(app));
// mountIfExists('./routes/reviews', (m) => m?.default?.(app));
// mountIfExists('./routes/targets', (m) => m?.default?.(app));

// ---- 404 & error handling ---------------------------------------------------
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));
import { errorHandler } from './middleware/errors';
app.use(errorHandler);

// ---- Listen -----------------------------------------------------------------
const PORT = Number(process.env.PORT || 8787);
const server = app.listen(PORT, () => log.info({ port: PORT }, '[api] listening'));

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});
