// Backend/src/index.ts
import express from 'express';
import cors from 'cors';

import { corsOptions } from './lib/cors';

// Routers present in your repo (per screenshots)
import presenceRouter from './routes/presence';
import registerStatusRoutes, { attachQuotaHelpers, type Ctx as StatusCtx } from './routes/status';
import registerFindNowRoutes from './routes/find-now';
import registerStreamRoutes from './routes/stream';
import aiRouter from './routes/ai';
import gateRouter from './routes/gate';
import reviewsRouter from './routes/reviews';
import scoreRouterFactory from './ui/api/routes.score';
import publicRouter from './server/routes.public';

// -------- lightweight task store used by find-now + stream --------
type Task = { id: string; userId: string; createdAt: number; done?: boolean; previewQ: any[]; leadsQ: any[] };
const tasks = new Map<string, Task>();

// -------- shared status/quota context --------
const ctx: StatusCtx & { tasks: Map<string, Task>; quota?: any } = {
  tasks,
  users: new Map(),
  quotaStore: new Map(),
  devUnlimited: (process.env.DEV_UNLIMITED || '').toLowerCase() === 'true',
};
attachQuotaHelpers(ctx);

// -------- app --------
const app = express();
app.set('trust proxy', true);

// Register Stripe webhook FIRST (needs raw body) — load only if file/envs exist
(async () => {
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      const mod = await import('./stripe'); // this file is EXCLUDED from compile; runtime only
      if (typeof (mod as any).registerStripeWebhook === 'function') {
        (mod as any).registerStripeWebhook(app);
        // eslint-disable-next-line no-console
        console.log('[stripe] webhook enabled');
      }
    }
  } catch {
    // no-op: webhook disabled if stripe not present
  }
})();

// Core middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: ['text/*', 'application/csv'], limit: '1mb' }));

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Presence on both roots (old and new clients)
app.use('/', presenceRouter);
app.use('/api/v1', presenceRouter);

// Status + quota
registerStatusRoutes(app, ctx);

// “find now” + streaming endpoints
registerFindNowRoutes(app, { tasks, quota: (ctx as any).quota });
registerStreamRoutes(app, { tasks });

// Feature routes
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/gate', gateRouter);
app.use('/api/v1/reviews', reviewsRouter);

// Score API (factory returns a Router)
try { app.use(scoreRouterFactory()); } catch { /* optional */ }

// Public routes
app.use('/api/v1', publicRouter);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// Listen
const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${PORT}`);
});
