// src/shared/catalog.ts
//
// Normalized buyers catalog loaded from env (AB + C) and optional city JSONL.
// Includes a light-weight scorer and a query function used by routes.
//
// Env keys we read (all optional):
//   - BUYERS_CATALOG_TIER_AB_JSON   -> stringified JSON (array OR {buyers:[...]})
//   - BUYERS_CATALOG_TIER_C_JSON    -> stringified JSON (array OR {buyers:[...]})
//   - BUYERS_CATALOG_CITY_JSONL_PATH -> absolute path to JSONL file (one BuyerRow per line)

import fs from "fs";
import path from "path";
import { EffectivePrefs, Tier } from "../shared/prefs";

// ----------------- Types -----------------

export type SizeBucket = "micro" | "small" | "mid" | "large";

export interface BuyerSignals {
  ecommerce?: boolean;
  retail?: boolean;
  wholesale?: boolean;
}

export interface BuyerRow {
  host: string;                 // domain only
  name?: string;
  tiers?: Tier[];               // ["A"] | ["B"] | ["C"] (default ["C"] if omitted)
  segments?: string[];          // domain categories: "beverage","food","beauty",...
  tags?: string[];              // materials/cues: "pouch","film","label","tin","bag",...
  cityTags?: string[];          // lowercase city slugs: "los angeles","minneapolis",...
  states?: string[];            // "ca","ny","tx" (optional)
  countries?: string[];         // "us","ca" ...
  size?: SizeBucket;            // coarse size guess
  signals?: BuyerSignals;       // soft indicators used in scoring
  source?: "seed" | "city" | "computed";
}

export interface BuyerCatalog {
  ab: BuyerRow[];               // pre-seeded larger logos
  c: BuyerRow[];                // mid/small market seeds
  city: Record<string, BuyerRow[]>; // city -> rows (optional, may be empty)
  version?: number;
}

// ----------------- Small utils -----------------

function normStr(s?: string): string {
  return (s || "").toLowerCase().trim();
}

export function normalizeHost(input: string): string {
  return normStr(input)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function uniqLower(a?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of a || []) {
    const n = normStr(v);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function hasAny<T>(needle: T[] | undefined, hay: T[] | undefined): boolean {
  if (!needle?.length || !hay?.length) return false;
  const set = new Set(hay);
  for (const n of needle) if (set.has(n)) return true;
  return false;
}

// Sanitize a BuyerRow to safe, normalized shapes
function sanitizeRow(r: any, defTier: Tier[] = ["C"]): BuyerRow {
  const host = normalizeHost(r?.host);
  const row: BuyerRow = {
    host,
    name: r?.name || undefined,
    tiers: uniqLower(asArray<string>(r?.tiers)).map(x => (x.toUpperCase() as Tier)),
    segments: uniqLower(asArray<string>(r?.segments)),
    tags: uniqLower(asArray<string>(r?.tags)),
    cityTags: uniqLower(asArray<string>(r?.cityTags)),
    states: uniqLower(asArray<string>(r?.states)),
    countries: uniqLower(asArray<string>(r?.countries)),
    size: (r?.size as SizeBucket) || undefined,
    signals: {
      ecommerce: !!r?.signals?.ecommerce,
      retail: !!r?.signals?.retail,
      wholesale: !!r?.signals?.wholesale,
    },
    source: r?.source === "seed" || r?.source === "city" || r?.source === "computed" ? r.source : "seed",
  };
  if (!row.tiers || row.tiers.length === 0) row.tiers = defTier;
  return row;
}

// Parse env JSON that may be either an array or { buyers: [...] }
function readBuyersFromEnv(key: string, defTier: Tier[]): BuyerRow[] {
  const raw = process.env[key];
  if (!raw) return [];
  try {
    const parsed: any = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((r) => sanitizeRow(r, defTier));
    if (Array.isArray(parsed?.buyers)) return parsed.buyers.map((r: any) => sanitizeRow(r, defTier));
    return [];
  } catch {
    return [];
  }
}

// Optional JSONL city catalog
function readCityJsonl(filePath?: string): Record<string, BuyerRow[]> {
  const cityIndex: Record<string, BuyerRow[]> = {};
  if (!filePath) return cityIndex;

  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) return cityIndex;

  const text = fs.readFileSync(p, "utf8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      const row = sanitizeRow({ ...obj, source: "city" });
      for (const city of row.cityTags || []) {
        if (!cityIndex[city]) cityIndex[city] = [];
        cityIndex[city].push(row);
      }
    } catch {
      // ignore bad line
    }
  }
  return cityIndex;
}

// ----------------- Loader (used at runtime) -----------------

let CACHED: BuyerCatalog | null = null;

export function loadEnvCatalog(): BuyerCatalog {
  if (CACHED) return CACHED;

  const ab = readBuyersFromEnv("BUYERS_CATALOG_TIER_AB_JSON", ["A"]);
  const c = readBuyersFromEnv("BUYERS_CATALOG_TIER_C_JSON", ["C"]);
  const cityPath = process.env.BUYERS_CATALOG_CITY_JSONL_PATH;
  const city = readCityJsonl(cityPath);

  CACHED = { ab, c, city, version: 1 };
  return CACHED;
}

// ----------------- Scoring -----------------

function sizeFactor(size: SizeBucket | undefined, prefs: EffectivePrefs): number {
  if (!size) return 0;
  return prefs.sizeWeight[size] ?? 0;
}

function localityBonus(row: BuyerRow, prefs: EffectivePrefs): number {
  if (!prefs.city) return 0;
  const wanted = normStr(prefs.city);
  return row.cityTags?.includes(wanted) ? prefs.signalWeight.local : 0;
}

function signalBonus(row: BuyerRow, prefs: EffectivePrefs): number {
  let s = 0;
  if (row.signals?.ecommerce) s += prefs.signalWeight.ecommerce;
  if (row.signals?.retail) s += prefs.signalWeight.retail;
  if (row.signals?.wholesale) s += prefs.signalWeight.wholesale;
  return s;
}

function categoryGate(row: BuyerRow, prefs: EffectivePrefs): number {
  // If allow list present, small bump when intersecting; if block list, penalize.
  let score = 0;
  if (prefs.categoriesAllow.length && hasAny(prefs.categoriesAllow, row.segments)) score += 0.3;
  if (prefs.categoriesBlock.length && hasAny(prefs.categoriesBlock, row.segments)) score -= 1.0;
  return score;
}

// Composite scorer (higher is better)
export function scoreBuyerForPrefs(row: BuyerRow, prefs: EffectivePrefs): number {
  let score = 0;

  // Size bias
  score += sizeFactor(row.size, prefs);

  // Locality + signals
  score += localityBonus(row, prefs);
  score += signalBonus(row, prefs);

  // Category nudges
  score += categoryGate(row, prefs);

  // Gentle tier sorting: C > B > A by default unless user changed focus
  const tiers = row.tiers || ["C"];
  const focus = prefs.tierFocus.join(",");
  const tier = tiers[0] || "C";

  // Default c>b>a; if user included A only, flip weight accordingly
  if (focus.includes("C") && tier === "C") score += 0.8;
  if (focus.includes("B") && tier === "B") score += 0.2;
  if (focus.includes("A") && tier === "A") score += 0.0;

  // Prefer small/mid when asked, penalize giants
  if (prefs.preferSmallMid) {
    if (row.size === "micro") score += 0.5;
    if (row.size === "small") score += 0.35;
    if (row.size === "mid") score += 0.1;
    if (row.size === "large") score -= 1.2;
  }

  return score;
}

// ----------------- Query API (used by routes) -----------------

export interface QueryResult {
  items: BuyerRow[];
  reason: string; // short debug string (can be shown in "why")
}

export function queryCatalog(prefs: EffectivePrefs, limit = 20): QueryResult {
  const catalog = loadEnvCatalog();

  // Pool by tier focus, but always make C the head for default focus
  const wantC = prefs.tierFocus.includes("C");
  const wantB = prefs.tierFocus.includes("B");
  const wantA = prefs.tierFocus.includes("A");

  const pool: BuyerRow[] = [];
  // Order matters (C first by default):
  if (wantC) pool.push(...catalog.c);
  if (wantB) pool.push(...catalog.ab.filter(r => (r.tiers?.includes("B"))));
  if (wantA) pool.push(...catalog.ab.filter(r => (r.tiers?.includes("A"))));

  // City enrichment (non-exclusive): if user has a city pref, include those rows too
  const cityKey = prefs.city ? normStr(prefs.city) : "";
  if (cityKey && catalog.city[cityKey]) {
    // Avoid never[] inference by pre-typing
    const cityRows: BuyerRow[] = catalog.city[cityKey];
    pool.push(...cityRows);
  }

  // Deduplicate by host
  const seen = new Set<string>();
  const unique: BuyerRow[] = [];
  for (const r of pool) {
    const h = normalizeHost(r.host);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    unique.push(r);
  }

  // Score + sort
  const scored = unique
    .map((r) => ({ row: r, score: scoreBuyerForPrefs(r, prefs) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);

  const reason =
    `catalog: pool=${pool.length}, unique=${unique.length}, out=${scored.length}` +
    (prefs.city ? ` • city=${prefs.city}` : "");

  return { items: scored, reason };
}

// Optional helper for the leads route: return only rows for a city
export function getCityCatalog(city: string): BuyerRow[] {
  const c = loadEnvCatalog().city;
  const key = normStr(city);
  if (!key) return [];
  return (c[key] || []).slice();
}

// Re-export a stable type alias routes/tests can use
export type { BuyerRow as CatalogRow };