// src/shared/env.ts
//
// Centralized, typed env/config + small helpers.
// Exports:
//   - type AppConfig
//   - CFG: AppConfig (validated, with defaults)
//   - capResults(isPro, want): caps result count by plan
//
// Notes:
//   • Names/casing match what the rest of the code imports:
//       CFG.googlePlacesApiKey
//       CFG.cacheTtlS
//       CFG.placesLimitDefault
//       CFG.allowTiers (Set<'A'|'B'|'C'>)
//   • All helpers typed to satisfy noImplicitAny.

export type TierChar = "A" | "B" | "C";

export interface AppConfig {
  // Guardrails
  allowTiers: Set<TierChar>;

  // Scoring / general knobs
  confidenceMin: number;
  earlyExitFound: number;

  // Probe / result limits
  maxProbesPerFindFree: number;
  maxProbesPerFindPro: number;
  maxResultsFree: number;
  maxResultsPro: number;

  // Quotas / cooldowns
  freeClicksPerDay: number;
  freeCooldownMin: number;

  // Cache TTL (seconds)
  cacheTtlS: number;

  // Host circuit breaker
  hostCircuitFails: number;
  hostCircuitCooldownS: number;

  // Feature toggles
  enableAutoTune: boolean;

  // Optional local file seed for city catalog
  catalogCityFile: string;

  // Google Places integration
  googlePlacesApiKey: string;     // from GOOGLE_PLACES_API_KEY
  placesLimitDefault: number;     // from PLACES_LIMIT_DEFAULT
}

// ------------- small typed parsers -------------

function envStr(key: string, def = ""): string {
  const v = process.env[key];
  return v == null || v === "" ? def : String(v);
}

function envInt(key: string, def: number): number {
  const v = Number(envStr(key, ""));
  return Number.isFinite(v) ? v : def;
}

function envFloat(key: string, def: number): number {
  const v = Number(envStr(key, ""));
  return Number.isFinite(v) ? v : def;
}

function envBool(key: string, def: boolean): boolean {
  const raw = envStr(key, "");
  if (raw === "") return def;
  const n = raw.trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

function parseAllowTiers(raw: string): Set<TierChar> {
  const s = raw.replace(/[^ABC]/gi, "").toUpperCase();
  const out = new Set<TierChar>();
  for (const ch of s) {
    if (ch === "A" || ch === "B" || ch === "C") out.add(ch);
  }
  // default to ABC if nothing parsed
  if (out.size === 0) {
    out.add("A"); out.add("B"); out.add("C");
  }
  return out;
}

// ------------- public helpers -------------

/** Cap result count by plan (free/pro) and requested limit. */
export function capResults(isPro: boolean, want: number): number {
  const floor = 1;
  const safeWant = Number.isFinite(want) ? Math.max(floor, Math.floor(want)) : floor;
  const planCap = isPro ? CFG.maxResultsPro : CFG.maxResultsFree;
  return Math.min(safeWant, planCap);
}

// ------------- build CFG -------------

export const CFG: AppConfig = {
  // Guardrails
  allowTiers: parseAllowTiers(envStr("ALLOW_TIERS", "ABC")),

  // Scoring / general knobs
  confidenceMin: envFloat("CONFIDENCE_MIN", 0.72),
  earlyExitFound: envInt("EARLY_EXIT_FOUND", 3),

  // Probe / result limits
  maxProbesPerFindFree: envInt("MAX_PROBES_PER_FIND_FREE", 20),
  maxProbesPerFindPro: envInt("MAX_PROBES_PER_FIND_PRO", 50),
  maxResultsFree: envInt("MAX_RESULTS_FREE", 3),
  maxResultsPro: envInt("MAX_RESULTS_PRO", 10),

  // Quotas / cooldowns
  freeClicksPerDay: envInt("FREE_CLICKS_PER_DAY", 2),
  freeCooldownMin: envInt("FREE_COOLDOWN_MIN", 30),

  // Cache TTL (seconds)
  cacheTtlS: envInt("CACHE_TTL_S", 600),

  // Host circuit breaker
  hostCircuitFails: envInt("HOST_CIRCUIT_FAILS", 5),
  hostCircuitCooldownS: envInt("HOST_CIRCUIT_COOLDOWN_S", 600),

  // Feature toggles
  enableAutoTune: envBool("ENABLE_AUTO_TUNE", true),

  // Optional local file seed for city catalog
  catalogCityFile: envStr("CATALOG_CITY_FILE", ""),

  // Google Places integration
  googlePlacesApiKey: envStr("GOOGLE_PLACES_API_KEY", ""),
  placesLimitDefault: envInt("PLACES_LIMIT_DEFAULT", 25),
};

// Optional: surface a tiny, readable summary for logs/debug
export function cfgSummary(): Record<string, unknown> {
  return {
    allowTiers: Array.from(CFG.allowTiers.values()).join(""),
    maxResultsFree: CFG.maxResultsFree,
    maxResultsPro: CFG.maxResultsPro,
    cacheTtlS: CFG.cacheTtlS,
    placesLimitDefault: CFG.placesLimitDefault,
    hasPlacesKey: CFG.googlePlacesApiKey ? true : false,
  };
}