// src/shared/env.ts
//
// Centralized, typed environment config + helpers.
// This version stays compatible with older routes:
//  - CFG.allowTiers is a Set<"A"|"B"|"C"> so code can call .has(...)
//  - capResults accepts ANY plan-like (string | false | undefined) and coerces

type NodeEnv = "development" | "production" | "test";

function envStr(name: string, fallback = ""): string {
  const v = process.env[name];
  return (v === undefined || v === null || v === "") ? fallback : String(v);
}
function envInt(name: string, fallback: number): number {
  const n = Number(envStr(name, ""));
  return Number.isFinite(n) ? n : fallback;
}
function parseCsv(input: string): string[] {
  return input.split(",").map(s => s.trim()).filter(Boolean);
}

export type Plan = "free" | "pro" | "ultimate";

export interface AppConfig {
  // server
  port: number;
  nodeEnv: NodeEnv;

  // cors
  allowOrigins: string[];

  // tiers
  allowTiers: Set<"A" | "B" | "C">;        // NOTE: Set, for legacy code using .has()
  allowTiersCode: "A" | "AB" | "ABC" | "B" | "BC" | "C";

  // global caps / cache
  cacheTtlS: number;
  maxResultsFree: number;
  maxResultsPro: number;
  freeClicksPerDay: number;
  freeCooldownMin: number;

  // places (optional)
  googlePlacesApiKey?: string;
  placesLimitDefault: number;

  // classifier knobs
  classifyCacheTtlS: number;
  classifyDailyLimit: number;
  fetchTimeoutMs: number;
  maxFetchBytes: number;
  geminiApiKey?: string;
}

// -------- derive config --------
const NODE_ENV = (envStr("NODE_ENV", "production") as NodeEnv);

const ALLOW_ORIGINS = parseCsv(envStr("ALLOW_ORIGINS", "")); // empty => allow same-origin only

const ALLOW_TIERS_RAW = envStr("ALLOW_TIERS", "ABC").toUpperCase();
const ALLOW_TIERS_CODE: AppConfig["allowTiersCode"] =
  (["A","AB","ABC","B","BC","C"] as const).includes(ALLOW_TIERS_RAW as any)
    ? (ALLOW_TIERS_RAW as any)
    : "ABC";

// convert code -> Set
function codeToSet(code: AppConfig["allowTiersCode"]): Set<"A"|"B"|"C"> {
  const s = new Set<"A"|"B"|"C">();
  if (code.includes("A")) s.add("A");
  if (code.includes("B")) s.add("B");
  if (code.includes("C")) s.add("C");
  return s;
}

export const CFG: AppConfig = {
  // server
  port: envInt("PORT", 8787),
  nodeEnv: NODE_ENV,

  // cors
  allowOrigins: ALLOW_ORIGINS,

  // tiers
  allowTiers: codeToSet(ALLOW_TIERS_CODE),
  allowTiersCode: ALLOW_TIERS_CODE,

  // global caps / cache
  cacheTtlS: envInt("CACHE_TTL_S", 300),              // 5m default
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

// -------- helpers --------

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true;                 // same-origin/XHR without Origin header
  if (!CFG.allowOrigins.length) return true; // permissive until configured
  return CFG.allowOrigins.some(o => origin.startsWith(o));
}

// Accept anything; coerce to a plan. Legacy routes sometimes pass `false`.
export function capResults(planLike: any, requested?: number): number {
  const plan = (typeof planLike === "string" ? planLike.toLowerCase() : "") as Plan | "";
  const req = Math.max(0, Number(requested ?? 0));
  if (plan === "pro" || plan === "ultimate") {
    return Math.min(req || CFG.maxResultsPro, CFG.maxResultsPro);
  }
  // default = free
  return Math.min(req || CFG.maxResultsFree, CFG.maxResultsFree);
}

export function isTierAllowed(tier: "A" | "B" | "C"): boolean {
  return CFG.allowTiers.has(tier);
}

export function summarizeForHealth() {
  return {
    nodeEnv: CFG.nodeEnv,
    allowTiers: Array.from(CFG.allowTiers).join(""),
    allowOrigins: CFG.allowOrigins.length,
    hasPlacesKey: Boolean(CFG.googlePlacesApiKey),
    classifyDailyLimit: CFG.classifyDailyLimit,
    cacheTtlS: CFG.cacheTtlS,
    maxResultsFree: CFG.maxResultsFree,
    maxResultsPro: CFG.maxResultsPro,
  };
}