// src/shared/catalog.ts
//
// Canonical catalog types + loader.
// Now supports env OR file secrets, and multiple shapes:
// - { buyers: [...] } (preferred)
// - raw array:        [ {...}, {...} ]
// - NDJSON:           one JSON object per line
//
// Env variables (any subset may be present):
//   BUYERS_CATALOG_TIER_C_JSON
//   BUYERS_CATALOG_TIER_AB_JSON
//   BUYERS_CATALOG_TIER_C_JSON_FILE       (path to file)
//   BUYERS_CATALOG_TIER_AB_JSON_FILE      (path to file)
//   CITY_CATALOG_FILE                     (path to file; optional extra source)

import fs from "node:fs";

// Re-export Tier/SizeBucket types
export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

// --- Types used by routes/leads.ts ---

export interface BuyerRow {
  host: string;                    // required, unique-ish key
  name?: string;

  // Targeting + classification
  tiers?: Tier[];                  // e.g. ["C"]
  size?: SizeBucket;               // optional hint
  segments?: string[];             // industry buckets
  tags?: string[];                 // free-form tags
  cityTags?: string[];             // normalized lowercase city names

  // Light metadata used by UI/logging
  platform?: string;               // "web" | "retail" | ...
  created?: string;                // ISO timestamp if present in seed

  // Computed by routes later (not set here):
  temp?: "warm" | "hot" | null;
  score?: number;
  why?: string;
}

export interface LoadedCatalog {
  rows: BuyerRow[];
}

// --- Env keys we read ---
const KEY_TIER_C = "BUYERS_CATALOG_TIER_C_JSON";
const KEY_TIER_AB = "BUYERS_CATALOG_TIER_AB_JSON";
const KEY_TIER_C_FILE = "BUYERS_CATALOG_TIER_C_JSON_FILE";
const KEY_TIER_AB_FILE = "BUYERS_CATALOG_TIER_AB_JSON_FILE";
const KEY_CITY_FILE = "CITY_CATALOG_FILE"; // optional catch-all

// --- internal cache ---
let CACHE: LoadedCatalog | null = null;

// ----------------- helpers -----------------

function lowerUniq(values: unknown): string[] {
  const out = new Set<string>();
  const arr = Array.isArray(values) ? values : [];
  for (const v of arr) {
    const s = String(v ?? "").toLowerCase().trim();
    if (s) out.add(s);
  }
  return [...out];
}

function safeReadFile(path?: string): string | null {
  if (!path) return null;
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function tryParseJSON(text?: string | null): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Accept various container shapes and return a plain array of raw buyer objects.
function extractRawArray(anyShape: any): any[] {
  if (!anyShape) return [];
  if (Array.isArray(anyShape)) return anyShape;
  if (Array.isArray(anyShape.buyers)) return anyShape.buyers;
  if (Array.isArray(anyShape.items)) return anyShape.items;
  return [];
}

/**
 * Parse string content that might be:
 *  - JSON object with buyers
 *  - JSON array
 *  - NDJSON (newline-delimited JSON)
 */
function parseBuyersFlexible(raw: string | null): any[] {
  if (!raw) return [];
  // First, try normal JSON
  const asJson = tryParseJSON(raw);
  if (asJson) return extractRawArray(asJson);

  // Fallback: NDJSON — parse each non-empty line
  const out: any[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const obj = tryParseJSON(s);
    if (obj && typeof obj === "object") out.push(obj);
  }
  return out;
}

function asArray(x: unknown): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v ?? "").trim()).filter(Boolean);
  if (x == null || x === "") return [];
  return [String(x).trim()].filter(Boolean);
}

function normalizeRow(anyRow: any): BuyerRow | null {
  if (!anyRow || typeof anyRow !== "object") return null;

  const host = String(anyRow.host || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!host) return null;

  // Accept both 'tier' and 'tiers'
  const tiersRaw = anyRow.tiers ?? (anyRow.tier ? [anyRow.tier] : []);

  // Accept 'city' string and/or 'cityTags' array
  const cityTags = lowerUniq(
    (anyRow.city ? [anyRow.city] : []).concat(asArray(anyRow.cityTags))
  );

  const row: BuyerRow = {
    host,
    name: (anyRow.name && String(anyRow.name)) || undefined,
    platform: (anyRow.platform && String(anyRow.platform)) || undefined,
    created: (anyRow.created && String(anyRow.created)) || undefined,

    // normalize arrays
    tiers: lowerUniq(tiersRaw) as Tier[],
    segments: lowerUniq(asArray(anyRow.segments)),
    tags: lowerUniq(asArray(anyRow.tags)),
    cityTags,

    // optional hint
    size: (anyRow.size as SizeBucket) || undefined,
  };

  return row;
}

function loadSourceFromEnvKeys(): any[] {
  const rawC = parseBuyersFlexible(process.env[KEY_TIER_C] ?? null);
  const rawAB = parseBuyersFlexible(process.env[KEY_TIER_AB] ?? null);
  return rawC.concat(rawAB);
}

function loadSourceFromFiles(): any[] {
  const fromC = parseBuyersFlexible(safeReadFile(process.env[KEY_TIER_C_FILE]));
  const fromAB = parseBuyersFlexible(safeReadFile(process.env[KEY_TIER_AB_FILE]));
  const fromCity = parseBuyersFlexible(safeReadFile(process.env[KEY_CITY_FILE]));
  return fromC.concat(fromAB).concat(fromCity);
}

function buildFromSources(): LoadedCatalog {
  // Gather from env JSON first (most explicit), then from file paths.
  const rawList: any[] = []
    .concat(loadSourceFromEnvKeys())
    .concat(loadSourceFromFiles());

  // Normalize + de-duplicate by host
  const seen = new Set<string>();
  const rows: BuyerRow[] = [];

  for (const r of rawList) {
    const norm = normalizeRow(r);
    if (!norm) continue;
    if (seen.has(norm.host)) continue;
    seen.add(norm.host);
    rows.push(norm);
  }

  return { rows };
}

// --- Public API ---

/** Returns cached catalog; builds once from env/files on first call. */
export function getCatalog(): LoadedCatalog {
  if (CACHE) return CACHE;
  CACHE = buildFromSources();
  return CACHE;
}

/** Rebuilds catalog from env/files and returns it (refreshes cache). */
export function loadCatalog(): LoadedCatalog {
  CACHE = buildFromSources();
  return CACHE;
}

// Small utility for tests/ops
export function __clearCatalogCache() {
  CACHE = null;
}