import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Public response item the free panel expects.
 */
export interface Candidate {
  host: string;
  platform: 'web';
  title: string;
  created: string;         // ISO
  temp: 'warm' | 'hot';
  why: string;             // human-readable reason
  score: number;           // internal score (0-100+), exposed for debugging/UX
}

/**
 * Internal catalog row we score against.
 */
type Size = 'small' | 'mid' | 'large';
type Vertical = 'cpg' | 'retail' | 'beauty' | 'beverage' | 'dairy' | 'household';
type Region = 'US' | 'CA' | 'US/CA';

interface CatalogRow {
  host: string;
  brand: string;
  region: Region;
  size: Size;
  category: Vertical;
  hasVendorPage?: boolean; // if we know they expose vendor/supplier info
}

// -------------------------------------------------------------------------------------------------
// Minimal, pragmatic buyer catalog (mid-market heavy). You can add/remove entries freely.
// If you want this in a separate module later, we can extract it cleanly.
// -------------------------------------------------------------------------------------------------
const CATALOG: CatalogRow[] = [
  // --- CPG: snacks / natural / household mid-market (US/CA) ---
  { host: 'lesserevil.com',      brand: 'LesserEvil',        region: 'US',   size: 'mid',  category: 'cpg',       hasVendorPage: true },
  { host: 'hippeas.com',         brand: 'Hippeas',           region: 'US',   size: 'mid',  category: 'cpg',       hasVendorPage: true },
  { host: 'rxbar.com',           brand: 'RXBAR',             region: 'US',   size: 'mid',  category: 'cpg',       hasVendorPage: true },
  { host: 'smartypantsvitamins.com', brand: 'SmartyPants',   region: 'US',   size: 'mid',  category: 'cpg',       hasVendorPage: true },
  { host: 'onceuponafarmorganics.com', brand: 'Once Upon a Farm', region: 'US', size: 'mid', category: 'cpg',     hasVendorPage: true },
  { host: 'madhava.com',         brand: 'Madhava',           region: 'US',   size: 'mid',  category: 'cpg' },
  { host: 'perfectsnacks.com',   brand: 'Perfect Snacks',    region: 'US',   size: 'mid',  category: 'cpg' },
  { host: 'califiafarms.com',    brand: 'Califia Farms',     region: 'US',   size: 'mid',  category: 'beverage' },
  { host: 'spindrift.com',       brand: 'Spindrift',         region: 'US',   size: 'mid',  category: 'beverage' },
  { host: 'drinkolipop.com',     brand: 'OLIPOP',            region: 'US',   size: 'mid',  category: 'beverage' },
  { host: 'bluebottlecoffee.com',brand: 'Blue Bottle',       region: 'US',   size: 'mid',  category: 'beverage' },
  { host: 'lacolombe.com',       brand: 'La Colombe',        region: 'US',   size: 'mid',  category: 'beverage' },
  { host: 'athleticbrewing.com', brand: 'Athletic Brewing',  region: 'US',   size: 'mid',  category: 'beverage' },

  // --- Dairy mid-market ---
  { host: 'siggis.com',          brand: "Siggi's",           region: 'US',   size: 'mid',  category: 'dairy' },
  { host: 'tillamook.com',       brand: 'Tillamook',         region: 'US',   size: 'mid',  category: 'dairy' },
  { host: 'chobani.com',         brand: 'Chobani',           region: 'US',   size: 'mid',  category: 'dairy' },
  { host: 'harmlessharvest.com', brand: 'Harmless Harvest',  region: 'US',   size: 'mid',  category: 'beverage' },

  // --- Beauty / household reasonable targets (not mega-cap like P&G/L’Oréal) ---
  { host: 'drbronner.com',       brand: "Dr. Bronner's",     region: 'US',   size: 'mid',  category: 'beauty',    hasVendorPage: true },
  { host: 'nativecos.com',       brand: 'Native',            region: 'US',   size: 'mid',  category: 'beauty'     },
  { host: 'functionofbeauty.com',brand: 'Function of Beauty',region: 'US',   size: 'mid',  category: 'beauty'     },
  { host: 'methodhome.com',      brand: 'Method',            region: 'US',   size: 'mid',  category: 'household'  },
  { host: 'mrsmyers.com',        brand: "Mrs. Meyer's",      region: 'US',   size: 'mid',  category: 'household'  },

  // --- Regional & specialty retail (move fast, practical packaging buyers) ---
  { host: 'heb.com',             brand: 'H-E-B',             region: 'US',   size: 'mid',  category: 'retail',    hasVendorPage: true },
  { host: 'gelsons.com',         brand: "Gelson's",          region: 'US',   size: 'small',category: 'retail',    hasVendorPage: true },
  { host: 'freshthyme.com',      brand: 'Fresh Thyme',       region: 'US',   size: 'mid',  category: 'retail'     },
  { host: 'newseasonsmarket.com',brand: 'New Seasons',       region: 'US',   size: 'mid',  category: 'retail'     },
  { host: 'bigsaverfoods.com',   brand: 'Big Saver Foods',   region: 'US',   size: 'small',category: 'retail'     },
  { host: 'sprouts.com',         brand: 'Sprouts',           region: 'US',   size: 'mid',  category: 'retail'     },
  { host: 'wegmans.com',         brand: 'Wegmans',           region: 'US',   size: 'mid',  category: 'retail'     },

  // --- Canada retail (regional chains) ---
  { host: 'saveonfoods.com',     brand: 'Save-On-Foods',     region: 'CA',   size: 'mid',  category: 'retail',    hasVendorPage: true },
  { host: 'longos.com',          brand: "Longo's",           region: 'CA',   size: 'mid',  category: 'retail'     },
  { host: 'calgarycoop.com',     brand: 'Calgary Co-op',     region: 'CA',   size: 'mid',  category: 'retail'     },
  { host: 'farmboy.ca',          brand: 'Farm Boy',          region: 'CA',   size: 'mid',  category: 'retail'     },
  { host: 'londondrugs.com',     brand: 'London Drugs',      region: 'CA',   size: 'mid',  category: 'retail'     },

  // --- A few larger, but still reasonable when supplier is clearly enterprise-facing ---
  { host: 'kroger.com',          brand: 'Kroger',            region: 'US',   size: 'large',category: 'retail',    hasVendorPage: true },
  { host: 'albertsons.com',      brand: 'Albertsons',        region: 'US',   size: 'large',category: 'retail',    hasVendorPage: true },

  // --- Safety: well-known vendor pages often used by suppliers to onboard ---
  { host: 'wholefoodsmarket.com',brand: 'Whole Foods',       region: 'US',   size: 'large',category: 'retail',    hasVendorPage: true },
  { host: 'traderjoes.com',      brand: 'Trader Joe’s',      region: 'US',   size: 'large',category: 'retail'     },
];

// -------------------------------------------------------------------------------------------------
// Heuristics
// -------------------------------------------------------------------------------------------------

function normalizeHost(h: string): string {
  return (h || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function regionAccepts(candidate: Region, wanted: string): boolean {
  if (!wanted) return true;
  const w = wanted.toUpperCase();
  if (candidate === 'US/CA') return w === 'US' || w === 'CA' || w === 'US/CA';
  if (candidate === 'US')    return w === 'US' || w === 'US/CA';
  if (candidate === 'CA')    return w === 'CA' || w === 'US/CA';
  return true;
}

/**
 * Infer vertical and packaging hints from supplier host string.
 */
function supplierHints(host: string): { verticals: Set<Vertical>, tags: string[] } {
  const h = host.toLowerCase();
  const v = new Set<Vertical>();
  const tags: string[] = [];

  const add = (x: Vertical) => v.add(x);

  // very light heuristics
  if (/(snack|chip|bar|granola|jerky|confection)/.test(h)) add('cpg');
  if (/(beauty|cosmetic|skincare|soap|lotion)/.test(h)) add('beauty');
  if (/(brew|coffee|tea|drink|beverage|soda|water|seltzer)/.test(h)) add('beverage');
  if (/(dairy|milk|yogurt|cream|cheese)/.test(h)) add('dairy');
  if (/(household|clean|detergent)/.test(h)) add('household');

  // packaging material hints
  if (/(shrink|stretch)/.test(h)) tags.push('stretch/shrink film');
  if (/(label|sticker)/.test(h))  tags.push('labels');
  if (/(box|carton|case)/.test(h)) tags.push('carton/box');
  if (/(bottle|can|tin|foil|metal)/.test(h)) tags.push('metal/can/foil');

  // default to broad cpg when we have no vertical
  if (!v.size) add('cpg');

  return { verticals: v, tags };
}

function sizeWeight(size: Size): number {
  switch (size) {
    case 'small': return 18;
    case 'mid':   return 28;
    case 'large': return 8; // we down-weight mega orgs for speed-to-win
  }
}

function scoreRow(row: CatalogRow, supplierHost: string, wantedRegion: string): { score: number, why: string[] } {
  const why: string[] = [];
  let score = 0;

  // base: mid-market preference
  const base = sizeWeight(row.size);
  score += base;

  // region
  if (regionAccepts(row.region, wantedRegion)) {
    score += 20;
    why.push(`region: ${row.region}`);
  } else {
    score -= 10;
  }

  // vertical fit
  const hints = supplierHints(supplierHost);
  if (hints.verticals.has(row.category)) {
    score += 30;
    const vLabel = row.category === 'cpg' ? 'general packaging' : `${row.category} packaging`;
    why.push(`fit: ${vLabel}`);
  }

  // packaging tags help a bit
  if (hints.tags.length) {
    score += Math.min(10, hints.tags.length * 3);
  }

  // vendor page known = easier path to start
  if (row.hasVendorPage) {
    score += 12;
    why.push('vendor page known');
  }

  // gentle boost when supplier brand/domain looks adjacent to buyer brand
  const s = supplierHost.replace(/\.(com|net|org|ca|io)$/, '');
  const b = row.host.replace(/\.(com|net|org|ca|io)$/, '');
  if (s && b && (s.includes('pack') || /pack(ag|)/.test(s))) {
    // packaging suppliers fit better with retailers/cpg than beauty/household sometimes;
    // leave neutral here – vertical handles it.
  }

  return { score, why };
}

function toCandidate(row: CatalogRow, supplierHost: string, whyBits: string[], score: number): Candidate {
  const created = new Date().toISOString();
  const temp: 'warm' | 'hot' = score >= 85 ? 'hot' : 'warm';
  const why = `${whyBits.join(' · ')} · (picked for supplier: ${supplierHost})`;
  return {
    host: row.host,
    platform: 'web',
    title: `Suppliers / vendor info | ${row.brand}`,
    created,
    temp,
    why,
    score
  };
}

// -------------------------------------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------------------------------------

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&region=US/CA&radius=50+mi
 */
router.get('/find-buyers', (req: Request, res: Response) => {
  const supplierHost = normalizeHost(String(req.query.host || ''));
  const region = String(req.query.region || 'US/CA').toUpperCase();

  if (!supplierHost) {
    return res.status(400).json({ error: 'Missing host' });
  }

  // Score all, filter reasonable scores, sort desc, take top N
  const scored = CATALOG.map(row => {
    const { score, why } = scoreRow(row, supplierHost, region);
    return { row, score, why };
  });

  // threshold: only keep candidates that break 45 (tune as needed)
  const items = scored
    .filter(s => s.score > 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(s => toCandidate(s.row, supplierHost, s.why, s.score));

  return res.json({ items });
});

/**
 * POST /api/leads/lock
 * Body: { host, title, temp?, why? } or { candidate: Candidate }
 * For now it's a no-op ACK (safe, won’t write to DB until we wire quotas).
 */
router.post('/lock', (req: Request, res: Response) => {
  const body = req.body || {};
  const c: Partial<Candidate> = body.candidate || body;

  const host = typeof c.host === 'string' ? normalizeHost(c.host) : '';
  const title = typeof c.title === 'string' ? c.title.trim() : '';

  if (!host || !title) {
    return res.status(400).json({ error: 'candidate with host and title required' });
  }

  // Quota / persistence can be added here later. For now, echo success.
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

/**
 * Optional: lightweight health for this router.
 */
router.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, catalogSize: CATALOG.length });
});

export default router;