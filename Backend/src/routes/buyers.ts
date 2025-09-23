import { Router, Request, Response } from 'express';

type FindParams = {
  host: string;
  region?: string;
  radius?: string;
};

type Lead = {
  host: string;
  platform: 'web';
  title: string;
  created: string;
  temp: 'warm' | 'cold' | 'hot';
  whyText: string;
};

const router = Router();

/* ------------------------------ helpers ------------------------------ */

function send(res: Response, status: number, body: any) {
  res.status(status).json(body);
}

function ok(res: Response, payload: Record<string, unknown>) {
  send(res, 200, { ok: true, ...payload });
}

function bad(res: Response, msg: string) {
  send(res, 400, { ok: false, error: msg });
}

function normHost(raw?: string): string {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^https?:\/\//i, ''); // strip scheme
  s = s.replace(/\/.*$/, '');         // strip path
  s = s.replace(/:\d+$/, '');         // strip port
  return s.toLowerCase();
}

function parseParams(req: Request): FindParams | null {
  const src = req.method === 'GET' ? req.query : (req.body ?? {});
  const host = normHost(String(src.host ?? ''));
  if (!host) return null;

  // Region like "US/CA" (leave as-is if provided)
  let region = src.region ? String(src.region) : undefined;

  // Radius like "50 mi" — keep original text; consumers are tolerant
  let radius = src.radius ? String(src.radius) : undefined;

  return { host, region, radius };
}

function synthLead(p: FindParams): Lead {
  const regionText = p.region ?? 'US/CA';
  const radiusText = p.radius ?? '50 mi';
  return {
    host: p.host,
    platform: 'web',
    title: `Buyer lead for ${p.host}`,
    created: new Date().toISOString(),
    temp: 'warm',
    whyText: `Compat shim matched (${regionText}, ${radiusText})`,
  };
}

/* ------------------------------ core handlers ------------------------------ */

async function handleFind(req: Request, res: Response) {
  const p = parseParams(req);
  if (!p) return bad(res, 'Missing or invalid "host"');

  // current behavior: one lead per click
  const item = synthLead(p);
  ok(res, { items: [item] });
}

async function handleFindOne(req: Request, res: Response) {
  const p = parseParams(req);
  if (!p) return bad(res, 'Missing or invalid "host"');

  // strict single match (same synthesized shim for now)
  const item = synthLead(p);
  ok(res, { item });
}

/* ------------------------------ routing matrix ------------------------------ */
/**
 * Supported paths (mounted under /api):
 *   GET/POST /buyers/find
 *   GET/POST /buyers/find-buyers
 *   GET/POST /buyers/find-one
 *   GET/POST /leads/find
 *   GET/POST /leads/find-buyers
 *   GET/POST /leads/find-one
 *   GET       /routes             -> introspection
 *   GET       /                   -> ping
 */

const FIND_PATHS       = ['/buyers/find', '/leads/find', '/find'];
const FIND_BUYERS      = ['/buyers/find-buyers', '/leads/find-buyers', '/find-buyers'];
const FIND_ONE_PATHS   = ['/buyers/find-one', '/leads/find-one', '/find-one'];

for (const p of [...FIND_PATHS, ...FIND_BUYERS]) {
  router.get(p, handleFind);
  router.post(p, handleFind);
}

for (const p of FIND_ONE_PATHS) {
  router.get(p, handleFindOne);
  router.post(p, handleFindOne);
}

// Lightweight ping for /api
router.get('/', (_req, res) => ok(res, { service: 'buyers-api', version: '1.0' }));

// Introspection used by the panel's probe
router.get('/routes', (_req, res) => {
  const lines: string[] = [];
  const add = (m: string, p: string) => lines.push(`${m} ${p}`);
  [...FIND_PATHS, ...FIND_BUYERS].forEach(p => (add('GET', p), add('POST', p)));
  FIND_ONE_PATHS.forEach(p => (add('GET', p), add('POST', p)));
  add('GET', '/');
  add('GET', '/routes');
  ok(res, { routes: lines });
});

export default router;