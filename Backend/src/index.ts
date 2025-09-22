// src/index.ts
import express from 'express';
import leadsRouter from './routes/leads';
import metricsRouter from './routes/metrics';

const app = express();
app.use(express.json());

// Healthcheck path must match the Dockerfile: /healthz
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// API routes
app.use('/api/v1/leads', leadsRouter);
app.use('/api/v1/metrics', metricsRouter);

// Northflank exposes PORT; default to 8787 when local
const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});

export default app;