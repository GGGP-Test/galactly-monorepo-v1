import express from 'express';
import cors from 'cors';
import makeHealthRouter from './routes/health';

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- Health ----------
const health = makeHealthRouter();
// mount at both root and /api/v1 so either path works
app.use('/', health);
app.use('/api/v1', health);

// ---------- (next routes go here, one at a time) ----------
// pattern to progressively enable features:
// if (process.env.ENABLE_PRESENCE === 'true') {
//   const { default: presence } = await import('./routes/presence');
//   app.use('/api/v1', presence());
// }

// last-resort 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`api listening on :${PORT}`));
