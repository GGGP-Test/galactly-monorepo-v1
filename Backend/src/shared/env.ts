// src/shared/env.ts
//
// Centralized, typed environment config + a few helpers.
// Keeps defaults safe/cheap for Free; everything is overridable via env.
//
// Referenced by: routes (leads, places, classify), guards, health, etc.

type NodeEnv = "development" | "production" | "test";

function envStr(name: string, fallback = ""): string {
  const v = process.env[name];
  return (v === undefined || v === null || v === "") ? fallback : String(v);
}
function envInt(name: string, fallback: number): number {
  const v = Number(envStr(name, ""));
  return Number.isFinite(v) ? v : fallback;
}
function envBool(name: string, fallback: boolean): boolean {
  const v = envStr(name, "").toLowerCase().trim();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}
function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export interface AppConfig {
  // server
  port: number;
  nodeEnv: NodeEnv;

  // cors
  allowOrigins: string[];

  // product/tier gates
  allowTiers: "A" | "AB" | "ABC" | "B" | "BC" | "C";

  // global caps / cache
  cacheTtlS: number;
  maxResultsFree: number;
  maxResultsPro: number;
  freeClicksPerDay: number;
  freeCooldownMin: number;

  // places
  googlePlacesApiKey?: string;
  placesLimitDefault: number;

  // classifier knobs
  classifyCacheTtlS: number;
  classifyDailyLimit: number;
  fetchTimeoutMs: number;
  maxFetchBytes: number;
  geminiApiKey?: string;
}

// ---- derive config from process.env with safe defaults ----
const NODE_ENV = (envStr("NODE_ENV", "production") as NodeEnv);

const ALLOW_ORIGINS = parseCsv(envStr("ALLOW_ORIGINS", "")); // empty = allow same-origin only (handled by CORS layer)

const ALLOW_TIERS_RAW = envStr("ALLOW_TIERS", "ABC").toUpperCase();
const ALLOW_TIERS: AppConfig["allowTiers"] =
  (["A","AB","ABC","B","BC","C"] as const).includes(ALLOW_TIERS_RAW as any)
    ? (ALLOW_TIERS_RAW as any)
    : "ABC";

export const CFG: AppConfig = {
  // server
  port: envInt("PORT", 8787),
  nodeEnv: NODE_ENV,

  // cors
  allowOrigins: ALLOW_ORIGINS,

  // product/tier gates
  allowTiers: ALLOW_TIERS,

  // global caps / cache
  cacheTtlS: envInt("CACHE_TTL_S", 300),              // 5m default for general caches
  maxResultsFree: envInt("MAX_RESULTS_FREE", 25),
  maxResultsPro: envInt("MAX_RESULTS_PRO", 100),
  freeClicksPerDay: envInt("FREE_CLICKS_PER_DAY", 50),
  freeCooldownMin: envInt("FREE_COOLDOWN_MIN", 5),

  // places
  googlePlacesApiKey: envStr("GOOGLE_PLACES_API_KEY", envStr("GOOGLE_PLACES_KEY", "")) || undefined,
  placesLimitDefault: envInt("PLACES_LIMIT_DEFAULT", 10),

  // classifier knobs
  classifyCacheTtlS: envInt("CLASSIFY_CACHE_TTL_S", 24 * 60 * 60), // 24h
  classifyDailyLimit: envInt("CLASSIFY_DAILY_LIMIT", 20),
  fetchTimeoutMs: envInt("FETCH_TIMEOUT_MS", 7000),
  maxFetchBytes: envInt("MAX_FETCH_BYTES", 1_500_000), // ~1.5MB
  geminiApiKey: envStr("GEMINI_API_KEY", "") || undefined,
};

// ---- helpers used by routes/guards ----

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true; // same-origin/XHR without Origin header
  if (!CFG.allowOrigins.length) return true; // permissive until configured
  return CFG.allowOrigins.some(o => origin.startsWith(o));
}

export type Plan = "free" | "pro" | "ultimate";
export function capResults(plan: Plan, requested?: number): number {
  const req = Math.max(0, Number(requested ?? 0));
  if (plan === "free") return Math.min(req || CFG.maxResultsFree, CFG.maxResultsFree);
  if (plan === "pro") return Math.min(req || CFG.maxResultsPro, CFG.maxResultsPro);
  // ultimate currently same as pro (can diverge later)
  return Math.min(req || CFG.maxResultsPro, CFG.maxResultsPro);
}

export function isTierAllowed(tier: "A" | "B" | "C"): boolean {
  const s = CFG.allowTiers;
  if (s === "ABC") return true;
  if (s === "AB") return tier !== "C";
  if (s === "BC") return tier !== "A";
  return s === tier;
}

export function summarizeForHealth() {
  return {
    nodeEnv: CFG.nodeEnv,
    allowTiers: CFG.allowTiers,
    allowOrigins: CFG.allowOrigins.length,
    hasPlacesKey: Boolean(CFG.googlePlacesApiKey),
    classifyDailyLimit: CFG.classifyDailyLimit,
    cacheTtlS: CFG.cacheTtlS,
    maxResultsFree: CFG.maxResultsFree,
    maxResultsPro: CFG.maxResultsPro,
  };
}