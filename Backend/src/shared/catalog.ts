// src/shared/catalog.ts
//
// Loads and filters the buyer catalog from env-backed secrets.
// Safe parsing, explicit types, and simple filtering helpers.
//
// Expected env keys (Northflank "Group secrets"):
//   - BUYERS_CATALOG_TIER_AB_JSON : stringified JSON {version:number, buyers: BuyerRow[]}
//   - BUYERS_CATALOG_TIER_C_JSON  : stringified JSON {version:number, buyers: BuyerRow[]}
//
// Optional (mounted file, future use):
//   - CATALOG_CITY_JSONL : absolute path to a JSONL file with rows that include { host, cityTags: string[] }
//
// This module only does loading + light filtering. Scoring happens in routes/leads.ts.

export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

export interface BuyerRow {
  host: string;               // domain only (lowercase)
  name?: string;
  tiers?: Tier[];             // default ["C"] if omitted
  segments?: string[];        // e.g. ["beverage","coffee"]
  tags?: string[];            // e.g. ["bag","label","shipper"]
  cityTags?: string[];        // e.g. ["los angeles","santa monica"]
  size?: SizeBucket;          // rough size hint
}

export interface CatalogEnvelope {
  version?: number;
  buyers?: BuyerRow[];
}

function lcDomain(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function normStrList(a?: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of a || []) {
    const x = String(v || "").toLowerCase().trim();
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function normTiers(a?: Tier[]): Tier[] {
  const valid: Tier[] = ["A", "B", "C"];
  const out: Tier[] = [];
  for (const t of a || []) {
    if (valid.includes(t)) out.push(t);
  }
  return out.length ? out : ["C"];
}

function normSize(s?: string): SizeBucket | undefined {
  const x = String(s || "").toLowerCase().trim();
  if (!x) return undefined;
  if (x === "micro" || x === "small" || x === "mid" || x === "large") return x;
  return undefined;
}

function normalizeRow(r: any): BuyerRow | null {
  const host = lcDomain(r?.host);
  if (!host) return null;
  return {
    host,
    name: r?.name ? String(r.name) : undefined,
    tiers: normTiers(r?.tiers),
    segments: normStrList(r?.segments),
    tags: normStrList(r?.tags),
    cityTags: normStrList(r?.cityTags),
    size: normSize(r?.size),
  };
}

function parseEnvCatalog(key: string): BuyerRow[] {
  // Avoid mixing ?? and || without parentheses:
  const raw = (process.env[key] ?? "");
  if (!raw || raw.trim() === "") return [];
  try {
    const env: CatalogEnvelope = JSON.parse(raw);
    const src = Array.isArray(env?.buyers) ? env.buyers : [];
    const out: BuyerRow[] = [];
    for (const r of src) {
      const n = normalizeRow(r);
      if (n) out.push(n);
    }
    return out;
  } catch {
    return [];
  }
}

// Optional JSONL city enrichment (safe-if-missing)
function parseCityJsonl(path?: string | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const p = (path ?? "").trim();
  if (!p) return map;
  try {
    // Lazy require so bundlers won’t choke in non-node contexts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs") as typeof import("fs");
    if (!fs.existsSync(p)) return map;
    const text = fs.readFileSync(p, "utf8");
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t);
        const host = lcDomain(row?.host);
        if (!host) continue;
        const cities = normStrList(row?.cityTags);
        if (!cities.length) continue;
        map.set(host, cities);
      } catch {
        // ignore bad line
      }
    }
  } catch {
    // ignore fs errors on platforms where fs is blocked
  }
  return map;
}

export interface LoadedCatalog {
  all: BuyerRow[];            // merged + normalized list
  byHost: Map<string, BuyerRow>;
}

/**
 * Load and merge AB + C catalogs, and enrich with city JSONL if provided.
 */
export function loadCatalog(): LoadedCatalog {
  const ab: BuyerRow[] = parseEnvCatalog("BUYERS_CATALOG_TIER_AB_JSON");
  const c: BuyerRow[] = parseEnvCatalog("BUYERS_CATALOG_TIER_C_JSON");

  // Explicit typing avoids never[] inference
  const merged: BuyerRow[] = [];
  for (const r of ab) merged.push(r);
  for (const r of c) merged.push(r);

  // Optional city enrichment
  const cityFile = (process.env.CATALOG_CITY_JSONL ?? "").trim();
  if (cityFile) {
    const cityMap = parseCityJsonl(cityFile);
    for (let i = 0; i < merged.length; i++) {
      const r = merged[i];
      const extra = cityMap.get(r.host);
      if (extra && extra.length) {
        merged[i] = { ...r, cityTags: normStrList([...(r.cityTags || []), ...extra]) };
      }
    }
  }

  const byHost = new Map<string, BuyerRow>();
  for (const r of merged) {
    byHost.set(r.host, r);
  }

  return { all: merged, byHost };
}

/**
 * Light query helper used by routes/leads.ts
 * Returns a filtered array (iterable).
 */
export function queryCatalog(opts?: {
  tiers?: Tier[];             // default: any
  allowSegments?: string[];   // if provided, require intersection
  blockSegments?: string[];   // if provided, exclude intersection
}): BuyerRow[] {
  const { all } = loadCatalog();

  const tiers = normTiers(opts?.tiers);
  const allow = normStrList(opts?.allowSegments);
  const block = normStrList(opts?.blockSegments);

  const result: BuyerRow[] = [];
  for (const r of all) {
    // tiers filter
    if (tiers.length) {
      const rt = normTiers(r.tiers);
      if (!rt.some(t => tiers.includes(t))) continue;
    }
    // block segments
    if (block.length && (r.segments || []).some(s => block.includes(String(s).toLowerCase()))) {
      continue;
    }
    // allow segments
    if (allow.length) {
      const has = (r.segments || []).some(s => allow.includes(String(s).toLowerCase()));
      if (!has) continue;
    }
    result.push(r);
  }
  return result;
}