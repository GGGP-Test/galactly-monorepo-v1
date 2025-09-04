// backend/src/index.ts
import express from 'express';
import compression from 'compression';
import cors from 'cors';

import { corsOptions } from './lib/cors';
import { router as healthRouter } from './routes/health';
import { router as presenceRouter } from './routes/presence';
import { router as jobsRouter } from './routes/jobs';

const app = express();

// middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// readiness probe for your host (Render/Fly/etc read this)
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

// ---- v1 router (single source of truth) ----
const v1 = express.Router();
v1.use(healthRouter);     // /status
v1.use(presenceRouter);   // /presence/online , /presence/beat
v1.use(jobsRouter);       // /find-now , /preview/poll , /leads/poll

// expose under /api/v1/*
app.use('/api/v1', v1);

// ALSO expose the same routes at the root so frontends that call
// https://.../status or /find-now (without /api/v1) keep working.
app.use('/', v1);

// default 404 (helps debugging if something slips through)
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

// boot
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}`);
});

export default app;
