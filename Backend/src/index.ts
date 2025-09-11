import express from 'express';
import cors from 'cors';
import leadsRouter from './routes/leads';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Mount the leads API at the expected prefix
app.use('/api/v1/leads', leadsRouter);

// Root for sanity
app.get('/', (_req, res) => res.send('packLead runtime'));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`runtime listening on :${port}`);
});
