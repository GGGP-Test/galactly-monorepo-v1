// Backend/src/index.ts
import express from 'express';
import cors from 'cors';

// our libs
import { corsOptions } from './lib/cors';

// routers you DO have
import presenceRouter from './routes/presence';
import registerStatusRoutes, { attachQuotaHelpers, type Ctx as StatusCtx } from './routes/status';
import registerFindNowRoutes from './routes/find-now';
import registerStreamRoutes from './routes/stream';
import aiRouter from './routes/ai';
import gateRouter from './routes/gate';
import reviewsRouter from './routes/reviews';
import pipelineRouter from './routes/routes.pipeline';          // defines /api/pipeline/* inside itself
import publicRouter from './server/routes.public';              // your “public” routes
import createScoreRouter from './ui/api/routes.score';          // UI scoring router
import { registerStripeWebhook } from './stripe';

// optional rate limiter; safe if present
let rateLimiterMw: express.RequestHandler | null = null;
try {
  // lazy require to avoid hard failure if the file moves
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { defaultRateLimiter } = require('./ops/rate-limit');
  rateLimiterMw = defaultRateLimiter.middleware();
} catch { /* optional */ }

// ----- lightweight task registry used by find-now + stream -----
type Task = {
  id: string;
  userId: string;
  createdAt: number;
  done?: boolean;
  previewQ: any[];
  leadsQ: any[];
};
const tasks = new Map<string, Task>();

// ----- shared status/quota context -----
const ctx: StatusCtx & {
  tasks: Map<string, Task>;
  quota?: any;
} = {
  tasks,
  users: new Map(),
  quotaStore: new Map(),
  devUnlimited: (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
};
attachQuotaHelpers(ctx);

// ----- app -----
const app = express();
app.set('trust proxy', true);

// 1) Stripe must be registered *before* JSON parser so we can read raw body
registerStripeWebhook(app);

// 2) core middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/*', 'application/csv'], limit: '1mb' }));
if (rateLimiterMw) app.use(rateLimiterMw);

// 3) health
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 4) presence on both roots (older clients call /presence/* without /api/v1)
app.use('/', presenceRouter);
app.use('/api/v1', presenceRouter);

// 5) status + quota
registerStatusRoutes(app, ctx);

// 6) “find now” + streaming endpoints
registerFindNowRoutes(app, { tasks, quota: (ctx as any).quota });
registerStreamRoutes(app, { tasks });

// 7) feature routes
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/gate', gateRouter);
app.use('/api/v1/reviews', reviewsRouter);

// routes.score returns a Router (already namespaced inside)
try { app.use(createScoreRouter()); } catch { /* optional */ }

// public routes (whatever paths that file defines)
app.use('/api/v1', publicRouter);

// pipeline router defines absolute paths like /api/pipeline/*
app.use('/', pipelineRouter);

// 8) 404 fallback
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// 9) listen
const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${PORT}`);
});
