// src/shared/catalog.ts
//
// Canonical catalog types + loader.
// Now with a small in-memory TTL cache so routes don’t rebuild on every hit.
// Exposes a stable shape: { rows: BuyerRow[] }.

import type { Tier, SizeBucket } from "./prefs";

// ---------- Types used by routes/leads.ts ----------
export interface BuyerRow {
  host: string;                    // required, unique-ish key
  name?: string;

  // Targeting + classification
  tiers?: Tier[];                  // e.g. ["C"] (we mostly care about "C")
  size?: SizeBucket;               // micro|small|mid|large (optional hint)
  segments?: string[];             // industry buckets (food, beverage, pharma…)
  tags?: string[];                 // free-form tags (e.g. "pouch","label","tin")
  cityTags?: string[];             // normalized lowercase city names

  // Light metadata used by UI/logging
  platform?: string;               // "web" | "retail" | "marketplace" | etc.
  created?: string;                // ISO timestamp if present in seed

  // Not set by catalog; routes compute these:
  temp?: "warm" | "hot" | null;
  score?: number;
  why?: string;
}

export interface LoadedCatalog {
  rows: BuyerRow[];
}

// ---------- Env keys (Northflank secret group injects these) ----------
const KEY_TIER_C = "BUYERS_CATALOG_TIER_C_JSON";
const KEY_TIER_AB = "BUYERS_CATALOG_TIER_AB_JSON";

// ---------- Tiny TTL cache ----------
type CacheCell = { at: number; data: LoadedCatalog };
let CACHE: CacheCell | null = null;

function ttlSec(): number {
  const n = Number(process.env.CATALOG_TTL_SEC ?? 300);
  if (!Number.isFinite(n)) return 300;
  // keep sane: 5s..3600s
  return Math.max(5, Math.min(3600, Math.floor(n)));
}

function cacheValid(cell: CacheCell | null): boolean {
  if (!cell) return false;
  return (Date.now() - cell.at) < ttlSec() * 1000;
}

// ---------- helpers ----------
function asArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(v => String(v ?? "").trim()).filter(Boolean);
  if (x == null || x === "") return [];
  return [String(x).trim()].filter(Boolean);
}

function lowerUniq(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    const s = String(v || "").toLowerCase().trim();
    if (s) out.add(s);
  }
  return [...out];
}

function safeParseObject(raw: string | undefined): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeRow(anyRow: any): BuyerRow | null {
  if (!anyRow || typeof anyRow !== "object") return null;

  const host = String(anyRow.host || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!host) return null;

  const row: BuyerRow = {
    host,
    name: (anyRow.name && String(anyRow.name)) || undefined,
    platform: (anyRow.platform && String(anyRow.platform)) || undefined,
    created: (anyRow.created && String(anyRow.created)) || undefined,

    // normalize arrays
    tiers: lowerUniq(asArray(anyRow.tiers)) as Tier[],
    segments: lowerUniq(asArray(anyRow.segments)),
    tags: lowerUniq(asArray(anyRow.tags)),
    cityTags: lowerUniq(asArray(anyRow.cityTags)),

    // optional hints
    size: (anyRow.size as SizeBucket) || undefined,
  };

  return row;
}

function buildFromEnv(): LoadedCatalog {
  // Expect both env values to look like: { "version": "x", "buyers": [ ... ] }
  const rawC = safeParseObject(process.env[KEY_TIER_C]);
  const rawAB = safeParseObject(process.env[KEY_TIER_AB]);

  const buyersC: any[] = Array.isArray(rawC?.buyers) ? rawC.buyers : [];
  const buyersAB: any[] = Array.isArray(rawAB?.buyers) ? rawAB.buyers : [];

  const allRaw = buyersC.concat(buyersAB);

  // Normalize + de-duplicate by host
  const seen = new Set<string>();
  const rows: BuyerRow[] = [];

  for (const r of allRaw) {
    const norm = normalizeRow(r);
    if (!norm) continue;
    if (seen.has(norm.host)) continue;
    seen.add(norm.host);
    rows.push(norm);
  }

  return { rows };
}

// ---------- Public API ----------

/**
 * Returns cached catalog if fresh; rebuilds from env when TTL expires.
 * Shape is always { rows: BuyerRow[] }.
 */
export function getCatalog(): LoadedCatalog {
  if (cacheValid(CACHE)) return CACHE!.data;
  const data = buildFromEnv();
  CACHE = { at: Date.now(), data };
  return data;
}

/**
 * Forces a rebuild from env (ignores TTL) and refreshes the cache.
 * Useful for /api/catalog/reload or when you update secrets.
 */
export function loadCatalog(): LoadedCatalog {
  const data = buildFromEnv();
  CACHE = { at: Date.now(), data };
  return data;
}

/** Clear the cache (primarily for tests or ops). */
export function __clearCatalogCache() {
  CACHE = null;
}

// Re-export for routes that import types from here
export type { Tier, SizeBucket } from "./prefs";