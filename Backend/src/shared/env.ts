// Centralized, typed env config + tiny guardrail helpers.
// No implicit-any anywhere.

export type ABC = "A" | "B" | "C";

export interface AppConfig {
  /** Global allow-list for tiers; e.g. ALLOW_TIERS=AB */
  allowTiers: Set<ABC>;

  /** Per-plan caps for outward results (used by leads.ts) */
  maxResultsFree: number;
  maxResultsPro: number;

  /** Optional runtime guardrails you may use elsewhere */
  freeClicksPerDay: number;
  freeCooldownMin: number;
  cacheTtlSec: number;
}

/* ---------- tiny helpers ---------- */

function clamp(n: number, lo: number, hi: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function envNum(key: string, def: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envStr(key: string, def: string): string {
  const raw = process.env[key];
  return raw == null || raw === "" ? def : String(raw);
}

function parseAllowTiers(input: string): Set<ABC> {
  const out = new Set<ABC>();
  const s = (input || "").toUpperCase();
  for (const ch of s) {
    if (ch === "A" || ch === "B" || ch === "C") out.add(ch);
  }
  // Fallback to all tiers if nothing valid provided
  if (out.size === 0) {
    out.add("A");
    out.add("B");
    out.add("C");
  }
  return out;
}

/* ---------- exported config ---------- */

export const CFG: AppConfig = {
  // e.g. ALLOW_TIERS=AB  (defaults to ABC)
  allowTiers: parseAllowTiers(envStr("ALLOW_TIERS", "ABC")),

  // outward result caps (feel free to tune via env)
  maxResultsFree: clamp(envNum("MAX_RESULTS_FREE", 3), 1, 50),
  maxResultsPro: clamp(envNum("MAX_RESULTS_PRO", 12), 1, 100),

  // optional extras you may wire elsewhere
  freeClicksPerDay: clamp(envNum("FREE_CLICKS_PER_DAY", 2), 0, 1_000),
  freeCooldownMin: clamp(envNum("FREE_COOLDOWN_MIN", 30), 0, 24 * 60),
  cacheTtlSec: clamp(envNum("CACHE_TTL_S", 600), 1, 86_400),
};

/**
 * Cap outward items by plan + caller request.
 * - If `requested` is NaN/invalid, we use the plan’s default.
 * - Always clamps to [1 .. planCap].
 */
export function capResults(isPro: boolean, requested: number): number {
  const planCap = isPro ? CFG.maxResultsPro : CFG.maxResultsFree;
  const want = Number.isFinite(requested) ? Math.floor(requested) : planCap;
  return clamp(want, 1, planCap);
}