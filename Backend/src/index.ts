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

// readiness probe for your host
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

// api v1
const v1 = express.Router();
v1.use(healthRouter);
v1.use(presenceRouter);
v1.use(jobsRouter);
app.use('/api/v1', v1);

// boot
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}`);
});

export default app;
