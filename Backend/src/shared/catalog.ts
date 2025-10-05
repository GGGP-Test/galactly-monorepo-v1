// src/shared/catalog.ts
//
// Centralized loader for the buyers catalog.
// - Merges three sources (all optional):
//   1) BUYERS_CATALOG_TIER_AB_JSON   -> {"version":1,"buyers":[...]}
//   2) BUYERS_CATALOG_TIER_C_JSON    -> {"version":1,"buyers":[...]}
//   3) CITY_CATALOG_FILE (JSON file)  -> [ {host,name,city,...}, ... ]
//
// Exposes both async and sync shapes so existing routes can use either:
//   - await loadCatalog()  -> full object { rows, total, byTier? }
//   - get()/rows()/all()   -> current in-memory array (sync, deduped)
//   - reload()             -> clears cache and rebuilds
//
// Notes
// - We keep this dependency-free and deterministic.
// - Normalizes various shapes into a BuyerRow[]
// - Tier defaults to "C" when missing.
// - File path default: /run/secrets/city-catalog.json
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from "fs";

export type Tier = "A" | "B" | "C";

export type BuyerRow = {
  host: string;
  name?: string;
  company?: string;
  city?: string;
  state?: string;
  country?: string;
  url?: string;
  tier?: Tier;
  tiers?: Tier[];
  tags?: string[];
  segments?: string[];
  size?: "micro" | "small" | "mid" | "large";
  revenueM?: number;
  employees?: number;
  sector?: string;
  materials?: string[];
  certs?: string[];
  [k: string]: any;
};

type Loaded = {
  rows: BuyerRow[];
  total: number;
  byTier?: Record<string, number>;
  loadedAt: string;
  source: {
    envAB: boolean;
    envC: boolean;
    file: string | null;
  };
};

const CITY_FILE = String(process.env.CITY_CATALOG_FILE || "/run/secrets/city-catalog.json");
const TTL_MS = Math.max(10_000, Number(process.env.CATALOG_TTL_S || 600) * 1000);

// ------------------------------ utils ---------------------------------------

const lc = (v: any) => String(v ?? "").trim().toLowerCase();

function asArray(x: any): any[] {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.rows)) return x.rows;
  if (Array.isArray(x?.items)) return x.items;
  if (Array.isArray(x?.buyers)) return x.buyers;
  return [];
}

function safeJSON(raw?: string): any {
  try {
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJSONFileSync(path: string): any {
  try {
    if (!fs.existsSync(path)) return null;
    const txt = fs.readFileSync(path, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function canonRow(r: any): BuyerRow | null {
  const host = lc(r?.host).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null;

  const tier = String(r?.tier || (Array.isArray(r?.tiers) ? r.tiers[0] : "C")).toUpperCase();
  const t: Tier = tier === "A" || tier === "B" ? (tier as Tier) : "C";

  const name = String(r?.name || r?.company || "").trim();
  const url = r?.url ? String(r.url) : `https://${host}`;

  const row: BuyerRow = {
    host,
    name,
    url,
    city: r?.city ? String(r.city) : undefined,
    state: r?.state ? String(r.state) : undefined,
    country: r?.country ? String(r.country) : undefined,
    tier: t,
    tiers: Array.isArray(r?.tiers) ? (r.tiers as Tier[]) : [t],
    tags: Array.isArray(r?.tags) ? r.tags : undefined,
    segments: Array.isArray(r?.segments) ? r.segments : undefined,
    size: r?.size,
    revenueM: Number.isFinite(r?.revenueM) ? Number(r.revenueM) : undefined,
    employees: Number.isFinite(r?.employees) ? Number(r.employees) : undefined,
    sector: r?.sector ? String(r.sector) : undefined,
    materials: Array.isArray(r?.materials) ? r.materials : undefined,
    certs: Array.isArray(r?.certs) ? r.certs : undefined,
  };
  return row;
}

function dedupByHost(rows: BuyerRow[]): BuyerRow[] {
  const seen = new Map<string, BuyerRow>();
  for (const r of rows) if (r && r.host) {
    if (!seen.has(r.host)) seen.set(r.host, r);
  }
  return [...seen.values()];
}

// ------------------------------- cache --------------------------------------

let _rows: BuyerRow[] = [];
let _loadedAt = 0;
let _lastMeta: Loaded["source"] = { envAB: false, envC: false, file: null };

function buildNow(): BuyerRow[] {
  const envAB = safeJSON(process.env.BUYERS_CATALOG_TIER_AB_JSON);
  const envC  = safeJSON(process.env.BUYERS_CATALOG_TIER_C_JSON);
  const fileData = readJSONFileSync(CITY_FILE);

  const rows: BuyerRow[] = [
    ...asArray(envAB).map(canonRow).filter(Boolean) as BuyerRow[],
    ...asArray(envC).map(canonRow).filter(Boolean) as BuyerRow[],
    ...asArray(fileData).map(canonRow).filter(Boolean) as BuyerRow[],
  ];

  _lastMeta = { envAB: !!envAB, envC: !!envC, file: fs.existsSync(CITY_FILE) ? CITY_FILE : null };
  return dedupByHost(rows);
}

function ensureFreshSync(): void {
  const stale = Date.now() - _loadedAt > TTL_MS;
  if (_rows.length === 0 || stale) {
    _rows = buildNow();
    _loadedAt = Date.now();
  }
}

// ------------------------------- exports ------------------------------------

export async function loadCatalog(): Promise<Loaded> {
  // Even the async path is instant (sync IO) to keep call sites simple.
  ensureFreshSync();

  const byTier: Record<string, number> = {};
  for (const r of _rows) {
    const t = (r.tier || "C") as Tier;
    byTier[t] = (byTier[t] || 0) + 1;
  }

  return {
    rows: _rows.slice(),
    total: _rows.length,
    byTier,
    loadedAt: new Date(_loadedAt || Date.now()).toISOString(),
    source: { ..._lastMeta },
  };
}

export function get(): BuyerRow[] {
  ensureFreshSync();
  return _rows.slice();
}

// Aliases some callers expect
export const rows = get;
export const all = get;

export function reload(): Loaded {
  _rows = buildNow();
  _loadedAt = Date.now();
  return {
    rows: _rows.slice(),
    total: _rows.length,
    loadedAt: new Date(_loadedAt).toISOString(),
    source: { ..._lastMeta },
  };
}

export default { loadCatalog, get, rows, all, reload };