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

const router = Router();

// ---- shared types (UI expects these) ----
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

// ---- simple “finder” shim (replace later with real logic) ----
async function synthFindOne(host: string, region: string, radius: string): Promise<StoredLead> {
  const lead = ensureLeadForHost(host);
  return saveByHost(host, {
    title: `Buyer lead for ${host}`,
    platform: 'web',
    why: `Compat shim matched (${region}, ${radius})`,
    // keep whatever temperature user previously set; default to warm on first sighting
    temperature: lead.temperature ?? 'warm',
  });
}

// ==================== FIND ====================
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

// Support multiple compat paths under /api/*
router.get('/buyers/find', doFind);
router.post('/buyers/find', doFind);
router.get('/buyers/find-one', doFind);
router.post('/buyers/find-one', doFind);
router.get('/buyers/find-buyers', doFind);
router.post('/buyers/find-buyers', doFind);

// ==================== LOCK (hot/warm/cold) ====================
router.post('/leads/lock', (req, res) => {
  const { host, temp } = pick(req);
  if (!host) return bad(res, 'host is required');
  if (!temp || !['hot', 'warm', 'cold'].includes(temp)) return bad(res, 'temp must be hot|warm|cold');

  const updated = replaceHotWarm(host, temp);
  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(body);
});

// Optional reset endpoint (not used by UI but handy)
router.post('/leads/reset', (req, res) => {
  const { host } = pick(req);
  if (!host) return bad(res, 'host is required');
  const updated = resetHotWarm(host);
  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(updated), watchers, competitors };
  return res.json(body);
});

// ==================== DEEPEN (enrichment shim) ====================
router.post('/leads/deepen', async (req, res) => {
  const { host } = pick(req);
  if (!host) return bad(res, 'host is required');

  // Fake enrichment — replace with your real pipeline later
  const enriched = saveByHost(host, {
    title: `Materials Manager @ ${host}`,
    why: 'Weak signals; might still be relevant for outreach.',
  });

  const { watchers, competitors } = getWatchers(host);
  const body: OkOne = { ok: true, item: toItem(enriched), watchers, competitors };
  return res.json(body);
});

// ==================== LIST / BUCKETS ====================
router.get('/leads/list', (_req, res) => {
  const { hot, warm, cold } = buckets();
  const m = {
    hot: hot.map(toItem),
    warm: warm.map(toItem),
    cold: cold.map(toItem),
  };
  const body: OkMany & { buckets: typeof m } = { ok: true, items: [...m.hot, ...m.warm, ...m.cold], buckets: m };
  return res.json(body);
});

router.get('/leads/hot', (_req, res) => {
  const { hot } = buckets();
  const body: OkMany = { ok: true, items: hot.map(toItem) };
  return res.json(body);
});

router.get('/leads/warm', (_req, res) => {
  const { warm } = buckets();
  const body: OkMany = { ok: true, items: warm.map(toItem) };
  return res.json(body);
});

router.get('/leads/cold', (_req, res) => {
  const { cold } = buckets();
  const body: OkMany = { ok: true, items: cold.map(toItem) };
  return res.json(body);
});

export default router;