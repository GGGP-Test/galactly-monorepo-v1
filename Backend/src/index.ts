// backend/src/index.ts
import express from 'express';
import cors from 'cors';

const PORT = Number(process.env.PORT || 8787);

// allow your GitHub Pages origin (and local dev)
const ALLOWED = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
if (!ALLOWED.length) {
  ALLOWED.push('https://gggp-test.github.io', 'http://localhost:4173', 'http://127.0.0.1:4173');
}

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      const ok = ALLOWED.some(a => origin === a || (a.endsWith('.github.io') && origin.endsWith('.github.io')));
      cb(null, ok);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-galactly-user'],
    maxAge: 86400,
    credentials: false,
  })
);

// ------------ shared router (mounted at "/" and "/api/v1") -------------
function buildRouter() {
  const r = express.Router();

  // health
  r.get('/healthz', (_req, res) => res.json({ ok: true }));

  // simple status for quotas (dev-unlimited via env)
  r.get('/status', (req, res) => {
    const devUnlimited = process.env.DEV_UNLIMITED === 'true';
    const uid = (req.headers['x-galactly-user'] as string) || '1000';
    res.json({
      ok: true,
      uid,
      plan: 'free',
      quota: { date: new Date().toISOString().slice(0, 10), findsUsed: 0, revealsUsed: 0, findsLeft: 99, revealsLeft: 5 },
      devUnlimited,
    });
  });

  // presence pings used by UI
  r.get('/presence/online', (_req, res) => res.json({ ok: true, t: Date.now() }));
  r.get('/presence/beat', (_req, res) => res.json({ ok: true, t: Date.now() }));

  // find-now: echo preview + fake task ids (your real worker can pick these up)
  r.post('/find-now', (req, res) => {
    const body = req.body || {};
    const site = String(body.website || body.site || '').replace(/^https?:\/\//, '');
    const regions = body.regions || 'US';
    const industries = body.industries || '';
    res.json({
      ok: true,
      previewTask: 't_preview_' + Math.random().toString(16).slice(2),
      leadsTask: 't_leads_' + Math.random().toString(16).slice(2),
      preview: [
        `Parsed site: ${site || '—'}`,
        `Regions: ${regions}`,
        `Industries: ${industries || '—'}`,
      ],
      items: [], // your lead worker can append later; keeping shape compatible
    });
  });

  // optional polling stubs so the UI never 404s
  r.get('/preview/poll', (_req, res) => res.json({ ok: true, lines: [] }));
  r.get('/leads/poll', (_req, res) => res.json({ ok: true, items: [] }));

  return r;
}

const router = buildRouter();
app.use('/', router);
app.use('/api/v1', router); // <— compatibility alias so /api/v1/* also works

// fallback for unknown routes (helps debugging)
app.use((_req, res) => res.status(404).json({ ok: false, error: 'not_found' }));

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
