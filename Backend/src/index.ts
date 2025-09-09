import express from 'express';
import cors from 'cors';

// core routers you already have
import presenceRouter from './routes/presence';
import registerStatusRoutes, { attachQuotaHelpers, type Ctx } from './routes/status';
import readyRouter from './routes/ready';
import metricsRouter from './routes/metrics';

// new/explicit mounts
import registerConfigRoutes from './routes/config';
import registerPublic from './server.route.public';
import { mountReveal } from './api/reveal';

// --- lightweight log (avoid external deps here) ---
const log = {
  info: (o: any, msg?: string) => console.log('[INFO]', msg ?? '', o ?? ''),
  error: (o: any, msg?: string) => console.error('[ERROR]', msg ?? '', o ?? ''),
};

// ---- Process-level safety ---------------------------------------------------
process.on('uncaughtException', (err) => log.error({ err }, 'uncaughtException'));
process.on('unhandledRejection', (reason) => log.error({ reason }, 'unhandledRejection'));

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

// request context
app.use((req, _res, next) => {
  (req as any).rid = Math.random().toString(36).slice(2);
  (req as any).userId = (req.header('x-galactly-user') || 'anon').toString();
  next();
});

// access log
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => log.info({ m:req.method, p:req.path, s:res.statusCode, ms: Date.now()-start }, 'req'));
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

// ---- Config/Public/Reveal ---------------------------------------------------
registerConfigRoutes(app);
registerPublic(app);
mountReveal(app);

// ---- Metrics ---------------------------------------------------------------
app.use('/', metricsRouter);

// ---- 404 & error -----------------------------------------------------------
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// ---- Listen ----------------------------------------------------------------
const PORT = Number(process.env.PORT || 8787);
const server = app.listen(PORT, () => log.info({ port: PORT }, '[api] listening'));

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});
