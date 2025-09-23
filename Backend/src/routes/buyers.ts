// src/routes/buyers.ts
import { Router, Request, Response } from 'express';
import MemStore from '../core/memStore';

// ---- types (match the panel’s expectations) ----
type Temp = 'hot' | 'warm' | 'cold';
type LeadItem = {
  host: string;
  platform?: 'web' | string;
  title?: string;
  created?: string;      // ISO
  temp?: Temp | string;  // keep loose for forward-compat
  whyText?: string;
};

type ApiOk = { ok: true; items: LeadItem[] };
type ApiErr = { ok: false; error: string };

// ---- cache (TTL & LRU) ----
const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS ?? 5 * 60_000);   // 5 minutes
const DEFAULT_MAX = Number(process.env.CACHE_MAX ?? 1_000);

const cache = new MemStore<LeadItem>({
  ttlMs: DEFAULT_TTL,
  max: DEFAULT_MAX,
});

// ---- helpers ----
function pickParams(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? '').trim();
  const region = String(q.region ?? '').trim() || 'US/CA';
  const radius = String(q.radius ?? '').trim() || '50 mi';
  return { host, region, radius };
}

function bad(res: Response, error: string, code = 400) {
  const body: ApiErr = { ok: false, error };
  return res.status(code).json(body);
}

function cacheKey(host: string, region: string, radius: string) {
  return `${host}|${region}|${radius}`;
}

// TEMP shim: replace with your real buyer-finder later.
async function computeLead(host: string, region: string, radius: string): Promise<LeadItem> {
  return {
    host,
    platform: 'web',
    title: `Buyer lead for ${host}`,
    created: new Date().toISOString(),
    temp: 'warm',
    whyText: `Compat shim matched (${region}, ${radius})`,
  };
}

async function findOne(host: string, region: string, radius: string): Promise<LeadItem> {
  const key = cacheKey(host, region, radius);
  return cache.getOrCreate(key, () => computeLead(host, region, radius));
}

async function handleFind(req: Request, res: Response) {
  const { host, region, radius } = pickParams(req);
  if (!host) return bad(res, 'host is required');

  try {
    const item = await findOne(host, region, radius);
    const body: ApiOk = { ok: true, items: [item] };
    return res.json(body);
  } catch (e: any) {
    return bad(res, e?.message ?? 'internal error', 500);
  }
}

// ---- router & routes ----
const r = Router();

/**
 * We expose buyers endpoints here. Your index.ts already mounts broader
 * "compat" paths (including /leads/... and /find-... under multiple roots).
 * Keeping this router focused avoids duplicate handlers.
 */
const BUYER_PATHS = ['/buyers/find', '/buyers/find-one', '/buyers/find-buyers'];
for (const p of BUYER_PATHS) {
  r.get(p, handleFind);
  r.post(p, handleFind);
}

// Optional: light diagnostics for cache (handy during dev; safe to leave)
r.get('/buyers/cache/stats', (_req, res) => res.json({ ok: true, stats: cache.getStats() }));

export default r;