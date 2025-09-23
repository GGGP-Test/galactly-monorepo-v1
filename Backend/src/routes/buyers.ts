import { Router, Request, Response } from 'express';
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  buckets,
  watchers as getWatchers,
  type StoredLead,
  type Temp,
} from '../shared/memStore';

// --------------------------------------------------
// Shared wire types the panel/integrations expect
// --------------------------------------------------
type LeadItem = {
  host: string;
  platform?: string;
  title?: string;
  created?: string;
  temp?: 'hot' | 'warm' | 'cold' | string;
  whyText?: string;
};

type OkMany = { ok: true; items: LeadItem[] };
type OkOne = { ok: true; item: LeadItem; watchers: string[]; competitors: string[] };
type Err = { ok: false; error: string };

const router = Router();

// ------------------ small utils -------------------
function bad(res: Response, error: string, code = 400) {
  const body: Err = { ok: false, error };
  return res.status(code).json(body);
}

function pick(req: Request) {
  const q = Object.assign({}, req.query, req.body);
  const host = String(q.host ?? '').trim();
  const region = String(q.region ?? '').trim() || 'US/CA';
  const radius = String(q.radius ?? '').trim() || '50 mi';
  const temp = (String(q.temp ?? '').trim().toLowerCase() as Temp) || undefined;
  return { host, region, radius, temp };
}

function toItem(s: StoredLead): LeadItem {
  return {
    host: s.host,
    platform: s.platform ?? 'web',
    title: s.title ?? `Buyer lead for ${s.host}`,
    created: s.created,
    temp: s.temperature,
    whyText: s.why,
  };
}

function safeHostname(urlLike?: string): string | undefined {
  if (!urlLike) return undefined;
  try {
    const u = urlLike.includes('://') ? new URL(urlLike) : new URL(`https://${urlLike}`);
    return u.hostname.replace(/^www\./, '').trim();
  } catch {
    return undefined;
  }
}

// Basic company-ish domain detector from text
function extractDomainFromText(txt?: string): string | undefined {
  if (!txt) return undefined;
  const m = txt.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  if (!m) return undefined;
  const host = m[1].toLowerCase();
  if (host.endsWith('github.com')) return undefined;
  return host;
}

// --------------------------------------------------
// FIND (compat shim – replace with real search later)
// --------------------------------------------------
async function synthFindOne(host: string, region: string, radius: string): Promise<StoredLead> {
  const lead = ensureLeadForHost(host);
  return saveByHost(host, {
    title: `Buyer lead for ${host}`,
    platform: 'web',
    why: `Compat shim matched (${region}, ${radius})`,
    temperature: lead.temperature ?? 'warm',
  });
}

async function doFind(req: Request, res: Response) {
  const { host, region, radius } = pick(req);
  if (!host) return bad(res, 'host is required');
  try {
    const found = await synthFindOne(host, region, radius);
    const body: OkMany = { ok: true, items: [toItem(found)] };
    return res.json(body);
  } catch (e: any) {
    return bad(res, e?.message ?? 'internal error', 500);
  }
}

// Multiple compat paths:
router.get('/buyers/find', doFind);
router.post('/buyers/find', doFind);
router.get('/buyers/find-one', doFind);
router.post('/buyers/find-one', doFind);
router.get('/buyers/find-buyers', doFind);
router.post('/buyers/find-buyers', doFind);

// --------------------------------------------------
// LOCK / RESET
// --------------------------------------------------
router.post('/leads/lock', (req, res) => {
  const { host, temp } = pick(req);
  if (!host) return bad(res, 'host is required');
  if (!temp || !['hot', 'warm', 'cold'].includes(temp)) return bad(res, 'temp must be hot|warm|cold');

  const updated = replaceHotWarm(host, temp);
  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(body);
});

router.post('/leads/reset', (req, res) => {
  const { host } = pick(req);
  if (!host) return bad(res, 'host is required');
  const updated = resetHotWarm(host);
  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(body);
});

// --------------------------------------------------
// DEEPEN (simple enrichment shim)
// --------------------------------------------------
router.post('/leads/deepen', async (req, res) => {
  const { host } = pick(req);
  if (!host) return bad(res, 'host is required');

  const enriched = saveByHost(host, {
    title: `Materials Manager @ ${host}`,
    why: 'Weak signals; might still be relevant for outreach.',
  });

  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(enriched), watchers, competitors };
  return res.json(body);
});

// --------------------------------------------------
// LIST / BUCKETS
// --------------------------------------------------
router.get('/leads/list', (_req, res) => {
  const { hot, warm, cold } = buckets();
  const m = { hot: hot.map(toItem), warm: warm.map(toItem), cold: cold.map(toItem) };
  const body: OkMany & { buckets: typeof m } = { ok: true, items: [...m.hot, ...m.warm, ...m.cold], buckets: m };
  return res.json(body);
});

router.get('/leads/hot', (_req, res) => res.json({ ok: true, items: buckets().hot.map(toItem) } as OkMany));
router.get('/leads/warm', (_req, res) => res.json({ ok: true, items: buckets().warm.map(toItem) } as OkMany));
router.get('/leads/cold', (_req, res) => res.json({ ok: true, items: buckets().cold.map(toItem) } as OkMany));

// --------------------------------------------------
// INGEST — single, bulk, and GitHub-shaped
// --------------------------------------------------

/**
 * Upsert a single lead
 * POST /api/ingest/lead
 * { host, title?, why?, platform?, temp? }
 */
router.post('/ingest/lead', (req, res) => {
  const { host, temp } = pick(req);
  if (!host) return bad(res, 'host is required');

  const patch: Partial<StoredLead> = {
    title: req.body?.title,
    platform: req.body?.platform ?? 'web',
    why: req.body?.why,
  };
  if (temp && ['hot', 'warm', 'cold'].includes(temp)) patch.temperature = temp;

  const updated = saveByHost(host, patch);
  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(body);
});

/**
 * Upsert many leads
 * POST /api/ingest/bulk
 * { items: [{ host, title?, why?, platform?, temp? }, ...] }
 */
router.post('/ingest/bulk', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return bad(res, 'items[] is required');

  const out: LeadItem[] = [];
  for (const raw of items) {
    const host = String(raw?.host ?? '').trim();
    if (!host) continue;
    const temp = (String(raw?.temp ?? '').trim().toLowerCase() as Temp) || undefined;
    const patch: Partial<StoredLead> = {
      title: raw?.title,
      platform: raw?.platform ?? 'web',
      why: raw?.why,
    };
    if (temp && ['hot', 'warm', 'cold'].includes(temp)) patch.temperature = temp;
    out.push(toItem(saveByHost(host, patch)));
  }
  const body: OkMany = { ok: true, items: out };
  return res.json(body);
});

/**
 * GitHub-shaped ingest (for zie619 stream or your n8n GitHub pulls)
 * POST /api/ingest/github
 * {
 *   repoUrl?: "https://github.com/owner/name",
 *   homepage?: "https://company.com",
 *   owner?: "owner",
 *   name?: "repo",
 *   description?: "...",
 *   topics?: ["..."],
 *   temp?: "warm"|"hot"|"cold"
 * }
 */
router.post('/ingest/github', (req, res) => {
  const body = req.body || {};
  // 1) Prefer homepage domain
  let host =
    safeHostname(body.homepage) ||
    // 2) If repoUrl provided, attempt to extract a domain from description or topics
    extractDomainFromText(body.description) ||
    extractDomainFromText(Array.isArray(body.topics) ? body.topics.join(' ') : undefined);

  // 3) If still missing, fall back to owner.github.io (many OSS/company sites do this)
  if (!host) {
    const owner = String(body.owner ?? '').trim();
    if (owner) host = `${owner.toLowerCase()}.github.io`;
  }

  if (!host) return bad(res, 'could not derive host from GitHub payload');

  const temp = (String(body.temp ?? '').toLowerCase() as Temp) || undefined;
  const patch: Partial<StoredLead> = {
    platform: 'web',
    title: body.name ? `Buyer lead for ${host}` : undefined,
    why:
      body.homepage
        ? `GitHub repo linked to ${safeHostname(body.homepage)}`
        : body.description
        ? `GitHub signal: ${String(body.description).slice(0, 160)}`
        : 'GitHub signal',
  };
  if (temp && ['hot', 'warm', 'cold'].includes(temp)) patch.temperature = temp;

  const updated = saveByHost(host, patch);
  const { watchers, competitors } = getWatchers(host);
  const resp: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(resp);
});

/**
 * Schema helper for integrators
 * GET /api/schema/ingest
 */
router.get('/schema/ingest', (_req, res) => {
  res.json({
    ok: true,
    endpoints: {
      single: 'POST /api/ingest/lead',
      bulk: 'POST /api/ingest/bulk',
      github: 'POST /api/ingest/github',
    },
    lead: {
      host: 'required domain, e.g., "acme.com"',
      title: 'optional string',
      why: 'optional string (human-friendly reason)',
      platform: 'optional string, default "web"',
      temp: 'optional "hot" | "warm" | "cold"',
    },
    github: {
      repoUrl: 'optional GitHub repo URL',
      homepage: 'optional URL (preferred source of host)',
      owner: 'optional repo owner',
      name: 'optional repo name',
      description: 'optional text used to heuristically extract domains',
      topics: 'optional array of strings',
      temp: 'optional "hot" | "warm" | "cold"',
    },
  });
});

export default router;