// src/shared/catalog.ts
//
// Canonical catalog types + loader.
// Always expose a consistent shape: { rows: BuyerRow[] }.

import type { Tier, SizeBucket } from "./prefs";

// --- Types used by routes/leads.ts ---

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
  temp?: "warm" | "hot" | null;    // not set by catalog; routes compute this
  score?: number;                  // not set by catalog; routes compute this
  why?: string;                    // not set by catalog; routes explain here
}

export interface LoadedCatalog {
  rows: BuyerRow[];
}

// --- Env keys we read (Northflank secret group) ---
const KEY_TIER_C = "BUYERS_CATALOG_TIER_C_JSON";
const KEY_TIER_AB = "BUYERS_CATALOG_TIER_AB_JSON";

// --- internal cache ---
let CACHE: LoadedCatalog | null = null;

// --- helpers ---

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

  const host = String(anyRow.host || "").toLowerCase()
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

    // not set here: temp, score, why (routes compute/explain those)
  };

  return row;
}

function buildFromEnv(): LoadedCatalog {
  // Both env values are expected to be JSON objects: { version, buyers: [...] }
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

// --- Public API ---

/**
 * Returns cached catalog; builds once from env on first call.
 * Shape is always { rows: BuyerRow[] }.
 */
export function getCatalog(): LoadedCatalog {
  if (CACHE) return CACHE;
  CACHE = buildFromEnv();
  return CACHE;
}

/**
 * Rebuilds the catalog from env (no network I/O) and returns it.
 * Also refreshes the cache used by getCatalog().
 */
export function loadCatalog(): LoadedCatalog {
  CACHE = buildFromEnv();
  return CACHE;
}

// Small utility for tests/ops
export function __clearCatalogCache() {
  CACHE = null;
}

// Re-export for routes that import types from here
export type { Tier, SizeBucket } from "./prefs";