import express from 'express';
import cors from 'cors';

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => console.log(`api listening on :${PORT}`));
