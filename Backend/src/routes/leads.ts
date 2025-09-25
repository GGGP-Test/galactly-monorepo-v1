// src/routes/leads.ts
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

/** UI shape */
export interface Candidate {
  host: string;
  platform: 'web';
  title: string;
  created: string;
  temp: 'warm' | 'hot';
  why: string;
  score: number;
}

type Size = 'small' | 'mid' | 'large';
type Vertical = 'cpg' | 'retail' | 'beauty' | 'beverage' | 'dairy' | 'household';
type Region = 'US' | 'CA' | 'US/CA';

interface CatalogRow {
  host: string;
  brand: string;
  region: Region;
  size: Size;
  category: Vertical;
  hasVendorPage?: boolean;
}

/* ------------------------------ Small built-in seed ------------------------------ */
const SEED: CatalogRow[] = [
  // CPG & beverage mid-market (good win-rate)
  { host: 'lesserevil.com', brand: 'LesserEvil', region: 'US', size: 'mid', category: 'cpg', hasVendorPage: true },
  { host: 'hippeas.com', brand: 'Hippeas', region: 'US', size: 'mid', category: 'cpg', hasVendorPage: true },
  { host: 'rxbar.com', brand: 'RXBAR', region: 'US', size: 'mid', category: 'cpg', hasVendorPage: true },
  { host: 'perfectsnacks.com', brand: 'Perfect Snacks', region: 'US', size: 'mid', category: 'cpg' },
  { host: 'califiafarms.com', brand: 'Califia Farms', region: 'US', size: 'mid', category: 'beverage' },
  { host: 'spindrift.com', brand: 'Spindrift', region: 'US', size: 'mid', category: 'beverage' },
  { host: 'drinkolipop.com', brand: 'OLIPOP', region: 'US', size: 'mid', category: 'beverage' },
  { host: 'lacolombe.com', brand: 'La Colombe', region: 'US', size: 'mid', category: 'beverage' },
  { host: 'athleticbrewing.com', brand: 'Athletic Brewing', region: 'US', size: 'mid', category: 'beverage' },

  // Dairy / household / beauty (non-megacap)
  { host: 'siggis.com', brand: "Siggi's", region: 'US', size: 'mid', category: 'dairy' },
  { host: 'tillamook.com', brand: 'Tillamook', region: 'US', size: 'mid', category: 'dairy' },
  { host: 'drbronner.com', brand: "Dr. Bronner's", region: 'US', size: 'mid', category: 'beauty', hasVendorPage: true },
  { host: 'methodhome.com', brand: 'Method', region: 'US', size: 'mid', category: 'household' },
  { host: 'mrsmyers.com', brand: "Mrs. Meyer's", region: 'US', size: 'mid', category: 'household' },

  // Regional retail (fast procurement)
  { host: 'gelsons.com', brand: "Gelson's", region: 'US', size: 'small', category: 'retail', hasVendorPage: true },
  { host: 'freshthyme.com', brand: 'Fresh Thyme', region: 'US', size: 'mid', category: 'retail' },
  { host: 'newseasonsmarket.com', brand: 'New Seasons', region: 'US', size: 'mid', category: 'retail' },
  { host: 'sprouts.com', brand: 'Sprouts', region: 'US', size: 'mid', category: 'retail' },
  { host: 'wegmans.com', brand: 'Wegmans', region: 'US', size: 'mid', category: 'retail' },

  // Canada retail
  { host: 'saveonfoods.com', brand: 'Save-On-Foods', region: 'CA', size: 'mid', category: 'retail', hasVendorPage: true },
  { host: 'longos.com', brand: "Longo's", region: 'CA', size: 'mid', category: 'retail' },
  { host: 'farmboy.ca', brand: 'Farm Boy', region: 'CA', size: 'mid', category: 'retail' },

  // Larger but legit when supplier is enterprise-ready
  { host: 'kroger.com', brand: 'Kroger', region: 'US', size: 'large', category: 'retail', hasVendorPage: true },
  { host: 'albertsons.com', brand: 'Albertsons', region: 'US', size: 'large', category: 'retail', hasVendorPage: true },
];

/* ---- Universal fallback when everything else filters out (still real buyers) ---- */
const UNIVERSAL_RETAIL: CatalogRow[] = [
  { host: 'heb.com', brand: 'H-E-B', region: 'US', size: 'mid', category: 'retail', hasVendorPage: true },
  { host: 'wholefoodsmarket.com', brand: 'Whole Foods', region: 'US', size: 'large', category: 'retail', hasVendorPage: true },
  { host: 'traderjoes.com', brand: 'Trader Joe’s', region: 'US', size: 'large', category: 'retail' },
  { host: 'londondrugs.com', brand: 'London Drugs', region: 'CA', size: 'mid', category: 'retail' },
  { host: 'calgarycoop.com', brand: 'Calgary Co-op', region: 'CA', size: 'mid', category: 'retail' },
];

/* -------------------------- External catalog (optional) -------------------------- */
function loadExternalCatalog(): CatalogRow[] {
  try {
    const envPath = process.env.BUYERS_CATALOG_PATH;
    const defaultPath = path.join(process.cwd(), 'data', 'buyers.catalog.json');
    const p = envPath || (fs.existsSync(defaultPath) ? defaultPath : '');
    if (!p) return [];
    const txt = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(txt) as CatalogRow[];
    return Array.isArray(json) ? json.filter(validRow) : [];
  } catch {
    return [];
  }
}

function validRow(r: any): r is CatalogRow {
  return r && typeof r.host === 'string' && typeof r.brand === 'string'
    && ['US', 'CA', 'US/CA'].includes(r.region)
    && ['small', 'mid', 'large'].includes(r.size)
    && ['cpg', 'retail', 'beauty', 'beverage', 'dairy', 'household'].includes(r.category);
}

const EXTERNAL: CatalogRow[] = loadExternalCatalog();
const CATALOG: CatalogRow[] = dedupeByHost([...SEED, ...EXTERNAL, ...UNIVERSAL_RETAIL]);

/* ---------------------------------- Helpers ---------------------------------- */
function dedupeByHost(rows: CatalogRow[]): CatalogRow[] {
  const seen = new Set<string>();
  const out: CatalogRow[] = [];
  for (const r of rows) {
    const h = normalizeHost(r.host);
    if (!seen.has(h)) {
      seen.add(h);
      out.push({ ...r, host: h });
    }
  }
  return out;
}

function normalizeHost(h: string): string {
  return (h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function regionAccepts(candidate: Region, wanted: string): boolean {
  const w = (wanted || '').toUpperCase();
  if (!w) return true;
  if (candidate === 'US/CA') return w === 'US' || w === 'CA' || w === 'US/CA';
  if (candidate === 'US') return w === 'US' || w === 'US/CA';
  if (candidate === 'CA') return w === 'CA' || w === 'US/CA';
  return true;
}

function supplierHints(host: string): { verticals: Set<Vertical>, tags: string[] } {
  const h = host.toLowerCase();
  const v = new Set<Vertical>();
  const tags: string[] = [];
  const add = (x: Vertical) => v.add(x);

  if (/(snack|chip|bar|granola|jerky|confect)/.test(h)) add('cpg');
  if (/(beauty|cosmetic|skincare|soap|lotion)/.test(h)) add('beauty');
  if (/(brew|coffee|tea|drink|beverag|soda|water|seltzer)/.test(h)) add('beverage');
  if (/(dairy|milk|yogurt|cream|cheese)/.test(h)) add('dairy');
  if (/(household|clean|detergent)/.test(h)) add('household');
  if (!v.size) add('cpg');

  if (/(shrink|stretch)/.test(h)) tags.push('stretch/shrink film');
  if (/(label|sticker)/.test(h)) tags.push('labels');
  if (/(box|carton|case)/.test(h)) tags.push('carton/box');
  if (/(bottle|can|tin|foil|metal)/.test(h)) tags.push('metal/can/foil');

  return { verticals: v, tags };
}

function sizeBase(size: Size): number {
  if (size === 'small') return 18;
  if (size === 'mid') return 28;
  return 8; // large – lower base
}

function sizePrefBonus(size: Size, pref: 'small' | 'mid' | 'any'): number {
  if (pref === 'any') return 0;
  if (pref === 'small') return size === 'small' ? 12 : size === 'mid' ? 4 : -12;
  // pref === 'mid'
  return size === 'mid' ? 12 : size === 'small' ? 6 : -10;
}

function scoreRow(
  row: CatalogRow,
  supplierHost: string,
  wantedRegion: string,
  verticalHint: Vertical | null,
  sizePref: 'small' | 'mid' | 'any'
): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 0;

  // size + preference
  score += sizeBase(row.size);
  const sizeAdj = sizePrefBonus(row.size, sizePref);
  score += sizeAdj;
  if (sizeAdj > 0) why.push(`size: ${row.size}`);

  // region
  if (regionAccepts(row.region, wantedRegion)) {
    score += 20;
    why.push(`region: ${row.region}`);
  } else {
    score -= 10;
  }

  // vertical
  const hints = supplierHints(supplierHost);
  const vmatch = verticalHint ? row.category === verticalHint : hints.verticals.has(row.category);
  if (vmatch) {
    score += 30;
    const vLabel = row.category === 'cpg' ? 'general packaging' : `${row.category} packaging`;
    why.push(`fit: ${vLabel}`);
  }

  // packaging tags awareness (weak signal)
  if (hints.tags.length) score += Math.min(10, hints.tags.length * 3);

  if (row.hasVendorPage) {
    score += 12;
    why.push('vendor page known');
  }

  return { score, why };
}

function toCandidate(row: CatalogRow, supplierHost: string, whyBits: string[], score: number): Candidate {
  const temp: 'warm' | 'hot' = score >= 85 ? 'hot' : 'warm';
  const created = new Date().toISOString();
  return {
    host: row.host,
    platform: 'web',
    title: `Suppliers / vendor info | ${row.brand}`,
    created,
    temp,
    why: `${whyBits.join(' · ')} · (picked for supplier: ${supplierHost})`,
    score
  };
}

/* ----------------------------------- Routes ----------------------------------- */

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US/CA&radius=50+mi&prefer=mid&vertical=cpg
 */
router.get('/find-buyers', (req: Request, res: Response) => {
  const supplierHost = normalizeHost(String(req.query.host || ''));
  const region = String(req.query.region || 'US/CA').toUpperCase();
  const prefer = (String(req.query.prefer || 'mid').toLowerCase() as 'small' | 'mid' | 'any');
  const verticalQ = String(req.query.vertical || '').toLowerCase();
  const verticalHint = (['cpg','retail','beauty','beverage','dairy','household'].includes(verticalQ) ? verticalQ as Vertical : null);

  if (!supplierHost) return res.status(400).json({ error: 'Missing host' });

  // score all rows
  const scored = CATALOG.map(row => {
    const { score, why } = scoreRow(row, supplierHost, region, verticalHint, prefer);
    return { row, score, why };
  });

  // 1) strict threshold
  let items = scored.filter(s => s.score > 50).sort((a,b) => b.score - a.score).slice(0, 12);

  // 2) relax if empty
  if (!items.length) items = scored.filter(s => s.score > 40).sort((a,b)=>b.score-a.score).slice(0, 12);

  // 3) fallback to universal retail focus for the region
  if (!items.length) {
    const uni = UNIVERSAL_RETAIL.filter(r => regionAccepts(r.region, region));
    const uniScored = uni.map(r => {
      const { score, why } = scoreRow(r, supplierHost, region, verticalHint, prefer);
      return { row: r, score, why };
    }).sort((a,b)=>b.score-a.score).slice(0,8);
    items = uniScored;
  }

  const out: Candidate[] = items.map(s => toCandidate(s.row, supplierHost, s.why, s.score));
  return res.json({ items: out });
});

/**
 * POST /api/leads/lock
 * Body: { host, title, temp?, why? } or { candidate: Candidate }
 */
router.post('/lock', (req: Request, res: Response) => {
  const body = req.body || {};
  const c: Partial<Candidate> = body.candidate || body;

  const host = typeof c.host === 'string' ? normalizeHost(c.host) : '';
  const title = typeof c.title === 'string' ? c.title.trim() : '';

  if (!host || !title) return res.status(400).json({ error: 'candidate with host and title required' });

  const out: Candidate = {
    host,
    platform: 'web',
    title,
    created: new Date().toISOString(),
    temp: (c.temp === 'hot' ? 'hot' : 'warm'),
    why: (typeof c.why === 'string' && c.why) || 'locked by user',
    score: typeof c.score === 'number' ? c.score : 0
  };

  return res.json({ ok: true, candidate: out });
});

router.get('/healthz', (_req, res) => {
  res.json({ ok: true, seed: SEED.length, external: EXTERNAL.length, total: CATALOG.length });
});

export default router;