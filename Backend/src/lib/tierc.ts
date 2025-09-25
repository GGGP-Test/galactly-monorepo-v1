/* src/lib/tierc.ts
 * Tier-C (and seed) catalog loader + scoring with city/tag boosts.
 * No network I/O here; pure data utilities used by routes/leads.ts
 */

export type Tier = 'A' | 'B' | 'C';

export interface BuyerRow {
  host: string;             // e.g., "vervecoffee.com"
  name?: string;            // e.g., "Verve Coffee"
  tiers?: Tier[];           // e.g., ["C"]
  segments?: string[];      // e.g., ["beverage","coffee"]
  tags?: string[];          // packaging-relevant tags like ["bag","label","shipper"]
  cityTags?: string[];      // e.g., ["los angeles","santa monica","la"]
  size?: 'tiny'|'small'|'mid'|'large'|'enterprise';
}

export interface Catalog {
  version?: number;
  buyers: BuyerRow[];
}

/** Public shape the API route will return to the client */
export interface Candidate {
  host: string;
  platform: 'web';
  title: string;
  created: string;                 // ISO
  temp: 'warm' | 'hot';
  why: string;                     // human readable reason
  score: number;                   // numeric for sorting/debug
}

/* ---------- helpers ---------- */

function parseJsonSafe<T>(raw?: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normCity(s?: string) {
  return (s || '').trim().toLowerCase();
}

function hasCityMatch(row: BuyerRow, city?: string): string | null {
  if (!city || !row.cityTags?.length) return null;
  const c = normCity(city);
  return row.cityTags.find(t => normCity(t) === c) || null;
}

function arrayOverlap(a?: string[], b?: string[]): string[] {
  if (!a?.length || !b?.length) return [];
  const setB = new Set(b.map(v => v.toLowerCase()));
  return a.filter(v => setB.has(v.toLowerCase()));
}

/** quick indicator that a brand is likely mega-cap (Tier A/B) by name token */
const BIG_CO_TOKENS = [
  'nestle','loreal','general mills','genmills','kraft','heinz','sc johnson',
  'pepsi','coca cola','coca-cola','unilever','pg','p&g','procter','gamble',
  'walmart','target','costco','amazon','albertsons','kroger','home depot',
  'lowes','campbell','clorox','nike','adidas','sephora','loblaw','metro'
];

/* ---------- loader ---------- */

export interface CatalogBundle {
  ab: Catalog;   // Tier A/B seed, mostly to deprioritize/exclude
  c: Catalog;    // Tier C seed, to prioritize
}

export function loadCatalogFromEnv(): CatalogBundle {
  const ab = parseJsonSafe<Catalog>(process.env.BUYERS_CATALOG_TIER_AB_JSON) ?? { buyers: [] };
  const c  = parseJsonSafe<Catalog>(process.env.BUYERS_CATALOG_TIER_C_JSON)  ?? { buyers: [] };
  return { ab, c };
}

/* ---------- scoring ---------- */

export interface MatchOpts {
  /** Optional city hint from the client (e.g., "Los Angeles") */
  city?: string;
  /** Optional packaging segment hints (e.g., ["beverage","beauty"]) */
  segmentHints?: string[];
  /** If true, strongly prefer Tier-C and downrank Tier-A/B */
  preferTierC?: boolean;
}

/** normalize a row into a Candidate plus a detailed score */
function toCandidate(row: BuyerRow, baseWhy: string, temp: 'warm'|'hot', score: number): Candidate {
  const title = row.name ? `Suppliers / vendor info | ${row.name}` : 'Suppliers / vendor info';
  return {
    host: row.host,
    platform: 'web',
    title,
    created: new Date().toISOString(),
    temp,
    why: baseWhy,
    score
  };
}

/** rough “is big” heuristic used to avoid surfacing mega brands when preferTierC */
function looksBigCompany(row: BuyerRow): boolean {
  if (row.tiers?.some(t => t === 'A' || t === 'B')) return true;
  const name = (row.name || row.host || '').toLowerCase();
  return BIG_CO_TOKENS.some(tok => name.includes(tok));
}

/**
 * Score a buyer row given the user's hints.
 *  - City match: strong boost
 *  - Segment overlap: medium boost
 *  - Tier-C preference: boost C, downrank A/B
 *  - Small/mid size hint gets a small boost
 */
export function scoreRow(row: BuyerRow, opts: MatchOpts): { score: number; temp: 'warm'|'hot'; whyParts: string[] } {
  let score = 0;
  const why: string[] = [];

  // Baseline
  score += 10;

  // Prefer Tier-C
  if (opts.preferTierC) {
    if (row.tiers?.includes('C') || row.size === 'tiny' || row.size === 'small' || row.size === 'mid') {
      score += 30;
      why.push('tierC/smb favored');
    }
    if (looksBigCompany(row)) {
      score -= 35; // push down mega brands
      why.push('downranked: large/enterprise');
    }
  }

  // City match
  const cityHit = hasCityMatch(row, opts.city);
  if (cityHit) {
    score += 35;
    why.push(`city: ${cityHit}`);
  }

  // Segment overlap
  const segHit = arrayOverlap(row.segments, opts.segmentHints);
  if (segHit.length) {
    score += 20;
    why.push(`segment: ${segHit.join(',')}`);
  }

  // Packaging-relevant tags give a small steady lift
  if (row.tags?.length) {
    score += Math.min(10, row.tags.length * 2);
    if (row.tags.length) why.push(`tags:${row.tags.slice(0,3).join('/')}`);
  }

  // Temp (warm/hot) is a simple function of score for now
  const temp: 'warm'|'hot' = score >= 70 ? 'hot' : 'warm';
  return { score, temp, whyParts: why };
}

/**
 * Produce ranked candidates from the combined catalogs.
 * We take all Tier-C rows and (optionally) include A/B rows that still rank decently
 * after scoring (useful fallback when Tier-C is sparse for a niche).
 */
export function rankCandidates(bundle: CatalogBundle, opts: MatchOpts, limit = 20): Candidate[] {
  const rows: BuyerRow[] = [
    ...(bundle.c.buyers || []),
    ...(bundle.ab.buyers || [])
  ];

  const scored = rows.map(r => {
    const s = scoreRow(r, opts);
    const why = [
      opts.preferTierC ? 'picked for supplier: tierC-first' : 'picked for supplier',
      ...(s.whyParts)
    ].join(' · ');
    return { row: r, cand: toCandidate(r, why, s.temp, s.score) };
  });

  // If preferTierC, drop clearly-big companies unless they still score well via city/segment
  const filtered = opts.preferTierC
    ? scored.filter(x => !looksBigCompany(x.row) || x.cand.score >= 65)
    : scored;

  return filtered
    .sort((a, b) => b.cand.score - a.cand.score)
    .slice(0, limit)
    .map(x => x.cand);
}

/* Convenience: single call used by the route */
export function findTierCCandidates(params: {
  city?: string;
  segmentHints?: string[];
  preferTierC?: boolean;
  limit?: number;
}): Candidate[] {
  const bundle = loadCatalogFromEnv();
  return rankCandidates(bundle, {
    city: params.city,
    segmentHints: params.segmentHints,
    preferTierC: params.preferTierC ?? true
  }, params.limit ?? 20);
}