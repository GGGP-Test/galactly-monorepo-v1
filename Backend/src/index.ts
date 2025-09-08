import 'dotenv/config';
import express, { type Express } from 'express';
import cors from 'cors';

import createScoreRouter from './ui/api/routes.score';
import { registerStripeWebhook } from './stripe';

const PORT = Number(process.env.PORT || 8080);

const app: Express = express();
app.set('trust proxy', true);

// Register Stripe webhook BEFORE global JSON parser (Stripe needs raw body)
registerStripeWebhook(app);

// Global middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health
app.get('/healthz', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// API
app.use('/api/v1', createScoreRouter());

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

// Listen
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api listening on :${PORT}`);
});
