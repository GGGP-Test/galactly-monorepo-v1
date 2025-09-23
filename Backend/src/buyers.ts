// src/routes/buyers.ts
import { Router, Request, Response } from 'express';

// --- response types the panel expects ---
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

const router = Router();

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

// TEMP shim; replace with the real buyer finder soon.
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

async function handleFindOne(req: Request, res: Response) {
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

async function handleFindMany(req: Request, res: Response) {
  // For now we return a single best match to keep UI moving.
  // Later we can fan out to multiple strategies and return N items.
  return handleFindOne(req, res);
}

// ---------- canonical API under /api ----------
router.get('/buyers/find-one', handleFindOne);
router.post('/buyers/find-one', handleFindOne);

router.get('/buyers/find', handleFindMany);
router.post('/buyers/find', handleFindMany);

// Alias used by the free panel (“leads/find-buyers”)
router.get('/leads/find-buyers', handleFindMany);
router.post('/leads/find-buyers', handleFindMany);

// Optional tiny index for quick smoke tests of this router scope
router.get('/', (_req, res) => res.json({ ok: true, scope: 'buyers' }));

export default router;