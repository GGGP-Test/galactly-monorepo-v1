// src/shared/catalog.ts
//
// Canonical catalog types + loader.
// Always expose a consistent shape: { rows: BuyerRow[] }.
// Sources (merged in this order):
//   1) BUYERS_CATALOG_TIER_C_JSON   (env secret: array OR {buyers: [...]})
//   2) BUYERS_CATALOG_TIER_AB_JSON  (env secret: array OR {buyers: [...]})
//   3) CITY_CATALOG_FILE (JSON file; default /run/secrets/city-catalog.json; array OR {buyers:[...]} )

import type { Tier, SizeBucket } from "./prefs";
import * as fs from "fs";

// ---------- Types used by routes/leads.ts ----------
export interface BuyerRow {
  host: string;                    // required, unique-ish key
  name?: string;

  // Targeting + classification
  tiers?: Tier[];                  // e.g. ["C"] (we mostly care about "C")
  size?: SizeBucket;               // micro|small|mid|large (optional hint)
  segments?: string[];             // industry buckets
  tags?: string[];                 // free-form tags (e.g. "pouch","label","tin")
  cityTags?: string[];             // normalized lowercase city names

  // Light metadata used by UI/logging (computed by routes, not by catalog)
  platform?: string;
  created?: string;
  temp?: "warm" | "hot" | null;
  score?: number;
  why?: string;
}

export interface LoadedCatalog {
  rows: BuyerRow[];
}

// ---------- Env keys / file path ----------
const KEY_TIER_C   = "BUYERS_CATALOG_TIER_C_JSON";
const KEY_TIER_AB  = "BUYERS_CATALOG_TIER_AB_JSON";
const FILE_PATH    = String(process.env.CITY_CATALOG_FILE || "/run/secrets/city-catalog.json");

// ---------- tiny helpers ----------
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

function tryParseJSON(raw: string | undefined): any | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Accept either a raw array OR an object with { buyers: [...] } */
function extractBuyers(maybe: any): any[] {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe;
  if (Array.isArray(maybe?.buyers)) return maybe.buyers;
  return [];
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
  };

  return row;
}

function readFileJSON(path: string): any | null {
  try {
    if (!fs.existsSync(path)) return null;
    const txt = fs.readFileSync(path, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function buildFromSources(): LoadedCatalog {
  // 1) Env secrets (your screenshots sometimes store a raw array)
  const envC  = tryParseJSON(process.env[KEY_TIER_C]);
  const envAB = tryParseJSON(process.env[KEY_TIER_AB]);

  const rawC  = extractBuyers(envC);
  const rawAB = extractBuyers(envAB);

  // 2) Optional file secret (array OR {buyers:[...]})
  const fileJSON = readFileJSON(FILE_PATH);
  const rawFile  = extractBuyers(fileJSON);

  // Merge all without using concat([]) to avoid TS never[] inference
  const merged: any[] = [];
  if (rawC.length)   merged.push(...rawC);
  if (rawAB.length)  merged.push(...rawAB);
  if (rawFile.length) merged.push(...rawFile);

  // Normalize + de-duplicate by host
  const seen = new Set<string>();
  const rows: BuyerRow[] = [];

  for (const r of merged) {
    const norm = normalizeRow(r);
    if (!norm) continue;
    if (seen.has(norm.host)) continue;
    seen.add(norm.host);
    rows.push(norm);
  }

  return { rows };
}

// ---------- Cache ----------
let CACHE: LoadedCatalog | null = null;

// ---------- Public API ----------
/** Returns cached catalog; builds once from env/file on first call. */
export function getCatalog(): LoadedCatalog {
  if (CACHE) return CACHE;
  CACHE = buildFromSources();
  return CACHE;
}

/** Rebuilds the catalog from env/file and returns it. */
export function loadCatalog(): LoadedCatalog {
  CACHE = buildFromSources();
  return CACHE;
}

/** Clear cache (tests/ops) */
export function __clearCatalogCache() {
  CACHE = null;
}

// Re-export for routes that import types from here
export type { Tier, SizeBucket } from "./prefs";