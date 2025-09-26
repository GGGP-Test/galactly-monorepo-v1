// src/shared/catalog.ts
// Lightweight buyer catalog loader + helpers.
// - Merges Tier A/B and Tier C JSON blobs from env
// - Optionally enriches with city-tags from a JSONL file (one JSON per line)
// - Exposes simple, well-typed helpers for routes

import fs from "fs";
import path from "path";

// keep these in sync with shared/prefs.ts
export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

export interface BuyerRow {
  host: string;                 // domain, normalized lower-case
  name?: string;
  tiers?: Tier[];               // e.g. ["C"] (can be empty -> treated as unknown)
  segments?: string[];          // "food","beverage","beauty","industrial","pharma",...
  tags?: string[];              // freeform labels: "ecommerce","retail","wholesale","bag","tin","film",...
  cityTags?: string[];          // normalized city names the buyer is associated with
  size?: SizeBucket;            // optional hint
  scoreBase?: number;           // optional hint for ranking
}

export interface BuyerCatalog {
  version: number;
  buyers: BuyerRow[];
}

// -------------------- internals --------------------

function normalizeHost(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function uniq<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of arr) {
    const key = typeof item === "string" ? item : JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const val = JSON.parse(raw) as T;
    return val;
  } catch {
    return fallback;
  }
}

function safeArray<A = unknown>(v: unknown): A[] {
  return Array.isArray(v) ? (v as A[]) : [];
}

function toBuyerRow(obj: any): BuyerRow | null {
  const host = normalizeHost(obj?.host);
  if (!host) return null;

  const row: BuyerRow = {
    host,
    name: typeof obj?.name === "string" ? obj.name : undefined,
    tiers: safeArray<Tier>(obj?.tiers).filter(Boolean),
    segments: safeArray<string>(obj?.segments).map(s => String(s || "").toLowerCase()),
    tags: safeArray<string>(obj?.tags).map(s => String(s || "").toLowerCase()),
    cityTags: safeArray<string>(obj?.cityTags).map(s => String(s || "").toLowerCase()),
    size: ((): SizeBucket | undefined => {
      const s = String(obj?.size || "").toLowerCase();
      return s === "micro" || s === "small" || s === "mid" || s === "large" ? (s as SizeBucket) : undefined;
    })(),
    scoreBase: Number.isFinite(obj?.scoreBase) ? Number(obj.scoreBase) : undefined,
  };

  return row;
}

function mergeBuyers(a: BuyerRow[], b: BuyerRow[]): BuyerRow[] {
  const byHost = new Map<string, BuyerRow>();
  for (const list of [a, b]) {
    for (const item of list) {
      const key = normalizeHost(item.host);
      if (!key) continue;
      const prev = byHost.get(key);
      if (!prev) {
        byHost.set(key, { ...item, host: key, tiers: uniq(item.tiers || []), segments: uniq(item.segments || []), tags: uniq(item.tags || []), cityTags: uniq(item.cityTags || []) });
      } else {
        // shallow merge, union arrays
        byHost.set(key, {
          host: key,
          name: item.name || prev.name,
          tiers: uniq([...(prev.tiers || []), ...(item.tiers || [])]),
          segments: uniq([...(prev.segments || []), ...(item.segments || [])]),
          tags: uniq([...(prev.tags || []), ...(item.tags || [])]),
          cityTags: uniq([...(prev.cityTags || []), ...(item.cityTags || [])]),
          size: item.size || prev.size,
          scoreBase: typeof item.scoreBase === "number" ? item.scoreBase : prev.scoreBase,
        });
      }
    }
  }
  return Array.from(byHost.values());
}

// -------------------- load from environment --------------------

/**
 * Reads env secrets and returns the full catalog (deduped).
 * Expected env:
 *  - BUYERS_CATALOG_TIER_AB_JSON : stringified {version:number, buyers: BuyerRow[]}
 *  - BUYERS_CATALOG_TIER_C_JSON  : stringified {version:number, buyers: BuyerRow[]}
 * Optional:
 *  - BUYERS_CATALOG_CITY_FILE    : path to JSONL; each line {"host":"x.com","cityTags":["seattle","wa"]}
 */
let _catalogMemo: BuyerCatalog | null = null;

export function getBuyerCatalog(): BuyerCatalog {
  if (_catalogMemo) return _catalogMemo;

  const abRaw = process.env.BUYERS_CATALOG_TIER_AB_JSON || "";
  const cRaw = process.env.BUYERS_CATALOG_TIER_C_JSON || "";

  const ab = parseJson<BuyerCatalog>(abRaw, { version: 1, buyers: [] });
  const c = parseJson<BuyerCatalog>(cRaw, { version: 1, buyers: [] });

  const abRows = safeArray<any>(ab?.buyers).map(toBuyerRow).filter(Boolean) as BuyerRow[];
  const cRows = safeArray<any>(c?.buyers).map(toBuyerRow).filter(Boolean) as BuyerRow[];

  let merged = mergeBuyers(abRows, cRows);

  // Optional city enrichment from file
  const cityFile = process.env.BUYERS_CATALOG_CITY_FILE;
  if (cityFile) {
    try {
      const p = path.resolve(cityFile);
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        const extra: Record<string, string[]> = {};
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          try {
            const obj = JSON.parse(t);
            const host = normalizeHost(obj?.host);
            const cities = safeArray<string>(obj?.cityTags).map(s => String(s || "").toLowerCase());
            if (host && cities.length) {
              extra[host] = uniq([...(extra[host] || []), ...cities]);
            }
          } catch {
            // ignore bad line
          }
        }
        if (Object.keys(extra).length) {
          merged = merged.map(r => {
            const added = extra[r.host];
            return added && added.length
              ? { ...r, cityTags: uniq([...(r.cityTags || []), ...added]) }
              : r;
          });
        }
      }
    } catch {
      // ignore file issues
    }
  }

  _catalogMemo = { version: Math.max(Number(ab?.version || 1), Number(c?.version || 1)), buyers: merged };
  return _catalogMemo;
}

// convenient short-hands
export function getBuyerRows(): BuyerRow[] {
  return getBuyerCatalog().buyers;
}

export function findByCityTag(cityLike: string): BuyerRow[] {
  const needle = String(cityLike || "").toLowerCase().trim();
  if (!needle) return [];
  const out: BuyerRow[] = [];
  for (const r of getBuyerRows()) {
    if ((r.cityTags || []).includes(needle)) out.push(r);
  }
  return out;
}

// small helper for routes that need a quick sanity reason
export function briefWhy(r: BuyerRow): string {
  const parts: string[] = [];
  if (r.segments?.length) parts.push(`segments:${r.segments.slice(0, 3).join(",")}${r.segments.length > 3 ? "…" : ""}`);
  if (r.tags?.length) parts.push(`tags:${r.tags.slice(0, 4).join(",")}${r.tags.length > 4 ? "…" : ""}`);
  if (r.tiers?.length) parts.push(`tier:${r.tiers.join(",")}`);
  return parts.join(" • ");
}