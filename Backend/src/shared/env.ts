// src/shared/env.ts
//
// Centralized, typed config + small helpers used across routes.
// - Keeps your existing fields (tiers, caps, cache, places)
// - Adds Gemini + classify/fetch guardrails for the classifier route
// - Back-compat for GOOGLE_PLACES_KEY / CACHE_TTL_SEC
// - Helpers: capResults(), toTier(), allowedByEnvTiers()

export type Tier = "A" | "B" | "C";

function n(v: unknown, def: number): number {
  const x = typeof v === "string" ? v.trim() : "";
  const num = x ? Number(x) : NaN;
  return Number.isFinite(num) ? num : def;
}
function b(v: unknown, def = false): boolean {
  const x = (typeof v === "string" ? v.trim() : "").toLowerCase();
  if (x === "1" || x === "true" || x === "yes" || x === "on") return true;
  if (x === "0" || x === "false" || x === "no" || x === "off") return false;
  return def;
}
function csvSet(v: unknown, valid: ReadonlyArray<string>): Set<string> {
  const raw = String(v || "").trim();
  if (!raw) return new Set<string>();
  const allow = new Set(valid.map((s) => s.toUpperCase()));
  const out = new Set<string>();
  for (const part of raw.split(",").map((s) => s.trim().toUpperCase())) {
    if (allow.has(part)) out.add(part);
  }
  return out;
}

// ---------- Config shape ----------
export interface AppConfig {
  // Global allow-list for tiers (e.g. ALLOW_TIERS=AB)
  allowTiers: Set<Tier>;

  // Free/pro result caps
  maxResultsFree: number;
  maxResultsPro: number;

  // Click / quota guards for free tier
  freeClicksPerDay: number;
  freeCooldownMin: number;

  // Small in-process cache TTL (seconds)
  cacheTtlS: number;

  // Google Places support
  googlePlacesApiKey?: string;
  placesLimitDefault: number;

  // Misc tuning
  confidenceMin: number;
  earlyExitFound: number;
  maxProbesPerFindFree: number;
  maxProbesPerFindPro: number;
  hostCircuitFails: number;
  hostCircuitCooldownS: number;

  // Feature flags
  enableAutoTune: boolean;

  // Optional file path for a city catalog (if mounted as secret file)
  catalogCityFile?: string;

  // --- Classifier / AI enrichment knobs ---
  geminiApiKey?: string;          // GEMINI_API_KEY (2.5 free tier OK)
  classifyCacheTtlS: number;      // CLASSIFY_CACHE_TTL_S
  classifyDailyLimit: number;     // CLASSIFY_DAILY_LIMIT
  fetchTimeoutMs: number;         // FETCH_TIMEOUT_MS for site fetch
  maxFetchBytes: number;          // MAX_FETCH_BYTES safety cap
}

// ---------- Load from process.env ----------
const E = process.env;

const allowTiers = (() => {
  const set = csvSet(E.ALLOW_TIERS, ["A", "B", "C"]) as Set<string>;
  // Default to ABC if unset
  return (set.size ? set : new Set(["A", "B", "C"])) as Set<Tier>;
})();

const cacheTtlFromEnv = (): number => {
  const v = E.CACHE_TTL_S ?? E.CACHE_TTL_SEC; // accept either
  return n(v, 600);
};

const googlePlacesKeyFromEnv = (): string | undefined => {
  // accept GOOGLE_PLACES_API_KEY or legacy GOOGLE_PLACES_KEY
  const k = (E.GOOGLE_PLACES_API_KEY || E.GOOGLE_PLACES_KEY || "").trim();
  return k || undefined;
};

export const CFG: AppConfig = {
  // --- your existing knobs ---
  allowTiers,

  maxResultsFree: n(E.MAX_RESULTS_FREE, 3),
  maxResultsPro: n(E.MAX_RESULTS_PRO, 8),

  freeClicksPerDay: n(E.FREE_CLICKS_PER_DAY, 25),
  freeCooldownMin: n(E.FREE_COOLDOWN_MIN, 30),

  cacheTtlS: cacheTtlFromEnv(),

  googlePlacesApiKey: googlePlacesKeyFromEnv(),
  placesLimitDefault: n(E.PLACES_LIMIT_DEFAULT, 10),

  confidenceMin: Number.isFinite(Number(E.CONFIDENCE_MIN))
    ? Number(E.CONFIDENCE_MIN)
    : 0.72,
  earlyExitFound: n(E.EARLY_EXIT_FOUND, 3),

  maxProbesPerFindFree: n(E.MAX_PROBES_PER_FIND_FREE, 20),
  maxProbesPerFindPro: n(E.MAX_PROBES_PER_FIND_PRO, 50),

  hostCircuitFails: n(E.HOST_CIRCUIT_FAILS, 5),
  hostCircuitCooldownS: n(E.HOST_CIRCUIT_COOLDOWN_S, 600),

  enableAutoTune: b(E.ENABLE_AUTO_TUNE, true),

  catalogCityFile: (E.CATALOG_CITY_FILE || "").trim() || undefined,

  // --- new AI/classifier knobs (safe defaults) ---
  geminiApiKey: (E.GEMINI_API_KEY || "").trim() || undefined,
  classifyCacheTtlS: n(E.CLASSIFY_CACHE_TTL_S, 86400), // 24h
  classifyDailyLimit: n(E.CLASSIFY_DAILY_LIMIT, 50),
  fetchTimeoutMs: n(E.FETCH_TIMEOUT_MS, 10000),
  maxFetchBytes: n(E.MAX_FETCH_BYTES, 800000),
};

// ---------- Small helpers used by routes ----------

/** Cap result count by plan + env maximums. */
export function capResults(isPro: boolean, requested?: number): number {
  const cap = Math.max(1, isPro ? CFG.maxResultsPro : CFG.maxResultsFree);
  const want = Number.isFinite(requested || NaN) && (requested as number) > 0
    ? Math.floor(requested as number)
    : cap;
  return Math.max(1, Math.min(want, cap));
}

/** Safely map a maybe-string to Tier or undefined. */
export function toTier(v: unknown): Tier | undefined {
  const s = String(v || "").toUpperCase();
  return s === "A" || s === "B" || s === "C" ? (s as Tier) : undefined;
}

/** True if any of row’s tiers are allowed by env (ALLOW_TIERS). */
export function allowedByEnvTiers(rowTiers?: ReadonlyArray<string>): boolean {
  if (!rowTiers?.length) return true;
  for (const t of rowTiers) {
    const up = String(t || "").toUpperCase() as Tier;
    if (CFG.allowTiers.has(up)) return true;
  }
  return false;
}