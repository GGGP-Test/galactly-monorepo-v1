// src/routes/buyers.ts
import { Router, Request, Response } from 'express';

/**
 * Response types the panel expects
 */
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

/**
 * -------- Tiny in-memory cache (per pod) --------
 * Keeps the panel snappy while we iterate on deeper signals.
 */
type CacheEntry = { item: LeadItem; exp: number };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes

function cacheKey(host: string, region: string, radius: string) {
  return `${host}|${region}|${radius}`;
}
function cacheGet(key: string): LeadItem | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit.item;
}
function cacheSet(key: string, item: LeadItem) {
  CACHE.set(key, { item, exp: Date.now() + TTL_MS });
}

/**
 * -------- Helpers --------
 */
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

function normalizeHost(input: string): string {
  if (!input) return '';
  let h = input.trim().toLowerCase();
  // strip protocol
  h = h.replace(/^https?:\/\//, '');
  // strip path/query/hash
  h = h.split(/[/?#]/)[0];
  // strip port and leading www
  h = h.replace(/:\d+$/, '').replace(/^www\./, '');
  return h;
}

function scoreTemp(score: number): LeadItem['temp'] {
  if (score >= 80) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

/**
 * -------- Pluggable “strategy” pipeline --------
 * Right now we run a few fast heuristics + caching. Later we’ll add:
 *  - DNS/company graph lookups
 *  - SERP / web signals
 *  - Historical success scoring
 *  - Model-based routing
 */
async function findOneBuyer(
  rawHost: string,
  region: string,
  radius: string
): Promise<LeadItem> {
  // Step 0: normalize and key
  const host = normalizeHost(rawHost);
  if (!host) throw new Error('host is required');

  const key = cacheKey(host, region, radius);
  const cached = cacheGet(key);
  if (cached) return cached;

  // Step 1: heuristics / light intent scoring
  const reasons: string[] = [];
  let score = 0;

  // Heuristic: region proximity (crude)
  if (/^US\//i.test(region)) {
    score += 10;
    reasons.push('US region');
  }

  // Heuristic: keyword hints in domain
  const kw = [
    'pack', // packaging, peakpackaging, etc.
    'supply',
    'warehouse',
    'logistics',
    'fulfill',
    'pallet',
    'film',
    'wrap',
  ];
  const matchedKw = kw.filter((k) => host.includes(k));
  if (matchedKw.length) {
    score += 20 + Math.min(20, matchedKw.length * 5);
    reasons.push(`domain hints: ${matchedKw.join(', ')}`);
  }

  // Heuristic: radius bias
  if (/\b(25|50)\s?mi\b/i.test(radius)) {
    score += 10;
    reasons.push(`search radius ${radius}`);
  } else if (/\b(5|10)\s?mi\b/i.test(radius)) {
    score += 5;
    reasons.push(`tight radius ${radius}`);
  }

  // Heuristic: company-like domain (has a dot and not a freemail)
  if (/\./.test(host) && !/(gmail|yahoo|outlook|icloud)\.com$/.test(host)) {
    score += 10;
    reasons.push('company domain');
  }

  // Step 2: assemble lead item
  const item: LeadItem = {
    host,
    platform: 'web',
    title: `Buyer lead for ${host}`,
    created: new Date().toISOString(),
    temp: scoreTemp(score),
    whyText: `${reasons.length ? reasons.join('; ') : 'compat shim'} (${region}, ${radius})`,
  };

  // Step 3: cache and return
  cacheSet(key, item);
  return item;
}

/**
 * -------- HTTP handlers --------
 */
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
  // For now we single-shot using the same pipeline.
  // When we add multi-strategy fan-out, this will return N items.
  return handleFindOne(req, res);
}

/**
 * -------- Router wiring (canonical under /api) --------
 */
const router = Router();

router.get('/buyers/find-one', handleFindOne);
router.post('/buyers/find-one', handleFindOne);

router.get('/buyers/find', handleFindMany);
router.post('/buyers/find', handleFindMany);

// Alias used by the free panel
router.get('/leads/find-buyers', handleFindMany);
router.post('/leads/find-buyers', handleFindMany);

// Scope smoke test
router.get('/', (_req, res) => res.json({ ok: true, scope: 'buyers', cacheSize: CACHE.size }));

export default router;