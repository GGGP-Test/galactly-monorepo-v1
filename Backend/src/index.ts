// Backend/src/index.ts
import express from 'express';
import cors from 'cors';

import registerFindNowRoutes from './routes/find-now';
import registerStreamRoutes from './routes/stream';
import { router as presenceRouter } from './routes/presence';
import registerStatusRoutes, { attachQuotaHelpers, type Ctx as StatusCtx } from './routes/status';

// Task store + runner types
import { createTaskStore } from './source-tasks';
import createScoreRouter from './ui/api/routes.score';
import { registerStripeWebhook } from './stripe';
const app = express();
app.use(express.json());
app.use(createScoreRouter());
registerStripeWebhook(app);
app.listen(process.env.PORT || 8080, () => console.log('up'));

// Routers we generated/keep


const PORT = Number(process.env.PORT || 8787);

// ---------- CORS ----------
const allowList = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// default: permissive for dev
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

// ---------- App ----------
const app = express();
app.set('trust proxy', true);
app.use(cors(corsOpts));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/*', 'application/csv'], limit: '1mb' }));

// Attach a simple user-id for convenience
app.use((req, _res, next) => {
  (req as any).userId = (req.header('x-galactly-user') || 'anon').toString();
  next();
});

// ---------- Shared context ----------
const tasks = createTaskStore();
const ctx: StatusCtx & {
  tasks: Map<string, any>;
  quota?: any;
} = {
  tasks,
  users: new Map(),
  quotaStore: new Map(),
  devUnlimited: (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
};
attachQuotaHelpers(ctx);

// ---------- Health ----------
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------- Presence (mount at both / and /api/v1 so both paths work) ----------
app.use('/', presenceRouter);
app.use('/api/v1', presenceRouter);

// ---------- Status (official under /api/v1/status) ----------
registerStatusRoutes(app, ctx);

// Alias for older frontends that call /status
app.get('/status', async (req, res) => {
  try {
    const userId = (req.header('x-galactly-user') || 'anon').toString();
    const quota = await (ctx as any).quota.status(userId);
    res.json({
      ok: true,
      uid: userId,
      plan: 'free',
      quota,
      devUnlimited: !!ctx.devUnlimited,
    });
  } catch {
    res.json({ ok: true, uid: 'anon', plan: 'free', quota: { findsLeft: 0, revealsLeft: 0 }, devUnlimited: !!ctx.devUnlimited });
  }
});

// ---------- Find-now + Streams ----------
registerFindNowRoutes(app, {
  tasks,
  // expose quota helpers to route (optional)
  quota: (ctx as any).quota,
});

registerStreamRoutes(app, { tasks });

// ---------- Fallback ----------
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// ---------- Listen ----------
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
