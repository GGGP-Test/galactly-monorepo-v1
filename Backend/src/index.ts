import express from 'express';
import cors from 'cors';
import { leads } from './routes/leads';
import { ensureSchema, hasDb } from './db';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, db: hasDb() }));

app.use('/api', leads);

// boot
const PORT = Number(process.env.PORT || 8787);
(async () => { try { await ensureSchema(); } catch {} })();

app.listen(PORT, () => {
  console.log(`buyers-api up on :${PORT}`);
});