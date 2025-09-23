// src/index.ts
import express, { Request, Response } from 'express';
import cors from 'cors';
import buyers from './routes/buyers';

// --- types the panel expects back ---
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: 'hot' | 'warm' | 'cold' | string;
  whyText?: string;
};
type ApiOk = { ok: true; items: LeadItem[] };
type ApiErr = { ok: false; error: string };

// create the app BEFORE using it
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// keep a registry so /routes can show what's mounted
const ROUTES: string[] = [];
const reg = (method: string, fullPath: string) =>
  ROUTES.push(`${method.toUpperCase()} ${fullPath}`);

// ---------- health & routes ----------
app.get('/healthz', (_req, res) => res.json({ ok: true, msg: 'healthy' }));
app.get('/routes', (_req, res) =>
  res.json({ ok: true, routes: [...new Set(ROUTES)].sort() })
);

// Mount the real router under /api
app.use('/api', buyers);
reg('USE', '/api/*');

// ---------- helpers ----------
function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? '').trim();
  const region = String(q.region ?? '').trim() || 'US/CA';
  const radius = String(q.radius ?? '').trim() || '50 mi';
  return { host, region, radius };
}

function sendBad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

// TEMP shim so the UI is unblocked; replace with real lookup later.
async function findOneBuyer(
  host: string,
  region: string,
  radius: string
): Promise<LeadItem> {
  return {
    host,
    platform: 'web',
    title: `Buyer lead for ${host}`,
    created: new Date().toISOString(),
    temp: 'warm',
    whyText: `Compat shim matched (${region}, ${radius})`,
  };
}

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return sendBad(res, 'host is required');

  try {
    const item = await findOneBuyer(host, region, radius);
    const body: ApiOk = { ok: true, items: [item] };
    return res.json(body);
  } catch (e: any) {
    return sendBad(res, e?.message ?? 'internal error', 500);
  }
}

// Mount a set of compat paths under several possible roots (but NOT /api to avoid dupes)
function mountCompat(root = '') {
  const base = (p: string) =>
    root ? `/${root.replace(/^\/+|\/+$/g, '')}${p}` : p;

  const paths = [
    '/leads/find-buyers',
    '/buyers/find-buyers',
    '/find-buyers',
    '/leads/find',
    '/buyers/find',
    '/find',
    '/leads/find-one',
    '/buyers/find-one',
    '/find-one',
  ];

  for (const p of paths) {
    app.get(base(p), handleFind);
    reg('GET', base(p));
    app.post(base(p), handleFind);
    reg('POST', base(p));
  }

  // simple index to show it's alive under this root
  app.get(base('/'), (_req, res) =>
    res.json({ ok: true, root: root || '(root)' })
  );
  reg('GET', base('/'));
}

mountCompat('');       // /
mountCompat('api/v1'); // /api/v1
mountCompat('v1');     // /v1

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api compat listening on :${PORT}`);
});

export default app;