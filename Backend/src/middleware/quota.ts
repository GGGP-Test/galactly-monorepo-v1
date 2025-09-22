// src/middleware/quota.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Plans we recognize. Keep tiny & boring on purpose.
 */
export type Plan = "free" | "pro" | "test" | "int";

/**
 * Per-plan limits. We only rate-limit "find-buyers" daily counts right now.
 * Keeping the shape minimal avoids TS noise ("extra property" errors).
 */
export interface PlanLimits {
  dailyFindBuyers: number;
}

/** Avoid Record<> to dodge "Record is not generic" shadowing in some repos. */
type LimitsMap = { free: PlanLimits; pro: PlanLimits; test: PlanLimits; int: PlanLimits };

export interface QuotaConfig {
  windowDays: number;            // rolling window size in days (effectively 1-day windows)
  limits: LimitsMap;             // per-plan limits
  testApiKey: string;            // special key allowed to use "test" plan when ALLOW_TEST=1
  allowTest: boolean;            // if 1, allow the test plan when apiKey===testApiKey
  disabled: boolean;             // if 1, bypasses all quota checks
}

/* ------------ env helpers ------------ */

const env = (k: string, d?: string) => (process.env[k] ?? d ?? "").trim();
const toInt = (v: string, d: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

function loadDefaultConfig(): QuotaConfig {
  const windowDays = toInt(env("QUOTA_WINDOW_DAYS", "1"), 1);

  const cfg: QuotaConfig = {
    windowDays,
    limits: {
      free: { dailyFindBuyers: toInt(env("FREE_DAILY", "3"), 3) },
      pro:  { dailyFindBuyers: toInt(env("PRO_DAILY",  "50"), 50) },
      test: { dailyFindBuyers: toInt(env("TEST_DAILY", "100"), 100) },
      int:  { dailyFindBuyers: toInt(env("INT_DAILY",  "10"), 10) },
    },
    testApiKey: env("QUOTA_TEST_API_KEY", ""),
    allowTest: env("ALLOW_TEST", "0") === "1",
    disabled:  env("QUOTA_DISABLE", "0") === "1",
  };
  return cfg;
}

let CONFIG: QuotaConfig = loadDefaultConfig();

/* ------------ in-memory usage store ------------ */

interface Usage {
  startMs: number;     // window start
  findBuyers: number;  // counter inside window
  plan: Plan;
}
const usageByKey: { [apiKeyOrIp: string]: Usage } = Object.create(null);

const DAY_MS = 86_400_000;
const windowStart = (days: number) => {
  if (days <= 1) {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
  const now = Date.now();
  const span = Math.max(1, days) * DAY_MS;
  return now - (now % span);
};

/* ------------ helpers to infer the plan/key ------------ */

function pickPlan(req: Request, apiKey: string): Plan {
  // Admin/client cannot spoof plan — we derive from apiKey/flags to keep it simple & safe
  if (CONFIG.allowTest && CONFIG.testApiKey && apiKey && apiKey === CONFIG.testApiKey) {
    return "test";
  }
  // TODO later: look up apiKey in DB to decide "pro" vs "free".
  return "free";
}

function clientKey(req: Request): string {
  // Prefer API key; fall back to IP so unauth users don't share one bucket across the world.
  const hdr = (req.headers["x-api-key"] || req.headers["X-API-Key"]) as string | undefined;
  const key = (hdr ?? "").trim();
  return key || (req.ip || req.socket.remoteAddress || "anon");
}

/* ------------ public admin-ish helpers (used in tests/ops) ------------ */

// Merge partial updates; you can set limits.free.dailyFindBuyers etc.
// We also accept flat overrides: { windowDays: 2 } etc.
export function configureQuota(partial: Partial<QuotaConfig> & { limits?: Partial<LimitsMap> }) {
  if (partial.windowDays !== undefined) CONFIG.windowDays = partial.windowDays;
  if (partial.testApiKey !== undefined) CONFIG.testApiKey = partial.testApiKey;
  if (partial.allowTest !== undefined) CONFIG.allowTest = partial.allowTest;
  if (partial.disabled !== undefined) CONFIG.disabled = partial.disabled;

  if (partial.limits) {
    CONFIG.limits = {
      free: { ...CONFIG.limits.free, ...(partial.limits.free ?? {}) },
      pro:  { ...CONFIG.limits.pro,  ...(partial.limits.pro  ?? {}) },
      test: { ...CONFIG.limits.test, ...(partial.limits.test ?? {}) },
      int:  { ...CONFIG.limits.int,  ...(partial.limits.int  ?? {}) },
    };
  }
}

export function resetQuota() {
  for (const k of Object.keys(usageByKey)) delete usageByKey[k];
}

export function snapshotQuota() {
  // return a shallow copy for inspection
  const out: any = {};
  for (const k of Object.keys(usageByKey)) out[k] = { ...usageByKey[k] };
  return { config: { ...CONFIG }, usage: out };
}

// Force a plan for a key (useful in integration/tests later)
export function setPlanForApiKey(_apiKey: string, _plan: Plan) {
  // No persistent mapping yet. Left as a future hook (kept for API surface compatibility).
}

/* ------------ the middleware factory itself ------------ */

/**
 * quota(): Express middleware for /find-buyers.
 * - Checks daily counter against limits for the caller's plan.
 * - Increments the counter if allowed.
 * - When blocked, returns 429 with { ok:false, error:"QUOTA", retryAfterMs }.
 *
 * You can pass an explicit plan ("free"/"pro"/"test"/"int") but normally you don't.
 */
export function quota(forced?: Plan): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (CONFIG.disabled) return next(); // global dev override

    const apiKey = clientKey(req);
    const plan: Plan = forced ?? pickPlan(req, apiKey);
    const limit = CONFIG.limits[plan] || CONFIG.limits.free;

    const nowStart = windowStart(CONFIG.windowDays);
    const bucket = usageByKey[apiKey] && usageByKey[apiKey].startMs === nowStart
      ? usageByKey[apiKey]
      : (usageByKey[apiKey] = { startMs: nowStart, findBuyers: 0, plan });

    // Only count POST /api/v1/leads/find-buyers (keep future-proof)
    const isFindBuyers = req.method === "POST" && /\/leads\/find-buyers$/.test(req.path);
    if (!isFindBuyers) return next();

    if (bucket.findBuyers >= limit.dailyFindBuyers) {
      const windowMs = Math.max(1, CONFIG.windowDays) * DAY_MS;
      const retryAfterMs = Math.max(1, bucket.startMs + windowMs - Date.now());
      res.status(429).json({ ok: false, error: "QUOTA", retryAfterMs, plan });
      return;
    }

    bucket.findBuyers++;
    next();
  };
}

/* Support both named and default import styles */
export default quota;