import express from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// basic health / status
app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/v1/status', (_req, res) =>
  res.json({
    ok: true,
    now: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime())
  })
);

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`api listening on :${PORT}`));
