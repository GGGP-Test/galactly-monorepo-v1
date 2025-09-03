import express from 'express';
import cors from 'cors';
import compression from 'compression';

import { router as jobRouter } from './routes/jobs';
import { router as healthRouter } from './routes/health';

export const app = express();

// basic middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(compression());

// root scope for v1
const v1 = express.Router();
v1.use(jobRouter);
v1.use(healthRouter);
app.use('/api/v1', v1);

// default health (for platform probe)
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}`);
});
