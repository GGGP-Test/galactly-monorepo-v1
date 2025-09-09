// Minimal, dependency-free server so the container boots
import express from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health endpoints (used by Northflank and you)
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  // keep logs super simple
  console.log(`api listening on :${PORT}`);
});
