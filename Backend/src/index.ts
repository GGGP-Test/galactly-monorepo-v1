import express from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// example API root so you can hit something
app.get('/api/v1/ping', (_req, res) => res.json({ ok: true, pong: true }));

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`api listening on :${PORT}`);
});
