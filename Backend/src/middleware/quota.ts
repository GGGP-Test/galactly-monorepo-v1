// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/** Plans we may see anywhere in this codebase. */
export type Plan = "free" | "pro" | "test" | "internal";

/** Per-plan limits. Extend as needed later. */
export interface PlanLimits {
  /** how many /find-buyers calls allowed per window */
  dailyFindBuyers: number;
}

/** A tiny mapped type to avoid relying on global `Record<>` */
type PlanMap<T> = {
  free: T;
  pro: T;
  test: T;
  internal: T;
};

/** Config the middleware understands. */
export interface QuotaConfig {
  /** sliding window in days (defaults to 1 day) */
  windowDays: number;
  /** plan -> limits */
  limits: PlanMap<PlanLimits>;
  /** hard off switch (1 = off) */
  disabled?: boolean;
  /** if ALLOW_TEST=1 and apiKey==testKey -> plan 'test' */
  testKey?: string;
  allowTestKey?: boolean;
}

/** --- env helpers -------------------------------------------------------- */

function num(env: string | undefined, dflt: number): number {
  const n = Number(env);
  return Number.isFinite(n) ? n : dflt;
}
function flag(env: string | undefined): boolean {
  return env === "1" || env === "true";
}

/** pull env once (values baked at boot) */
const ENV = {
  QUOTA_DISABLE: flag(process.env.QUOTA_DISABLE),
  QUOTA_WINDOW_DAYS: num(process.env.QUOTA_WINDOW_DAYS, 1),

  FREE_DAILY: num(process.env.FREE_DAILY, 3),
  PRO_DAILY: num(process.env.PRO_DAILY, 25),
  TEST_DAILY: num(process.env.TEST_DAILY, 100),
  INT_DAILY: num(process.env.INT_DAILY, 1000),

  ALLOW_TEST: flag(process.env.ALLOW_TEST),
  TEST_API_KEY: (process.env.QUOTA_TEST_API_KEY || "").trim(),
};

/** defaults derived from env (safe fallbacks baked in) */
const DEFAULT_LIMITS: PlanMap<PlanLimits> = {
  free: { dailyFindBuyers: ENV.FREE_DAILY },
  pro: { dailyFindBuyers: ENV.PRO_DAILY },
  test: { dailyFindBuyers: ENV.TEST_DAILY },
  internal: { dailyFindBuyers: ENV.INT_DAILY },
};

/** global, mutable config (can be adjusted at runtime via helpers) */
let CONFIG: QuotaConfig = {
  windowDays: Math.max(1, ENV.QUOTA_WINDOW_DAYS),
  limits: DEFAULT_LIMITS,
  disabled: ENV.QUOTA_DISABLE,
  testKey: ENV.TEST_API_KEY,
  allowTestKey: ENV.ALLOW_TEST,
};

/** manual plan overrides per API key (tiny in-memory map for now) */
const planForApiKey = new Map<string, Plan>();

/** usage bucket:
 *  key is `${apiKey}|${plan}|${bucket}|${epochDay}`  */
type Usage = { used: number; resetAt: number };
const usage = new Map<string, Usage>();

/** epoch day index respecting windowDays */
function windowIndex(ms: number, windowDays: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor(ms / dayMs / windowDays);
}
function msUntilWindowEnd(nowMs: number, windowDays: number): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const w = windowIndex(nowMs, windowDays);
  const end = (w + 1) * windowDays * dayMs;
  return Math.max(0, end - nowMs);
}
function clientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] || "").toString();
  return (fwd.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
}

/** figure out apiKey and plan for the request */
function resolveIdentity(req: Request): { apiKey: string; plan: Plan } {
  const hdrKey = (req.header("x-api-key") || "").trim();
  const hdrPlan = (req.header("x-plan") || "").trim().toLowerCase();

  // explicit override first
  if (hdrKey && planForApiKey.has(hdrKey)) {
    return { apiKey: hdrKey, plan: planForApiKey.get(hdrKey)! };
  }

  // special test key (if allowed)
  if (ENV.ALLOW_TEST && hdrKey && ENV.TEST_API_KEY && hdrKey === ENV.TEST_API_KEY) {
    return { apiKey: hdrKey, plan: "test" };
  }

  // honor x-plan when provided, but constrain to known values
  const candidate =
    hdrPlan === "pro" || hdrPlan === "test" || hdrPlan === "internal" ? (hdrPlan as Plan) : "free";

  const key = hdrKey || `ip:${clientIp(req)}`;
  return { apiKey: key, plan: candidate };
}

/** returns usage bucket key + current window reset time */
function bucketKey(apiKey: string, plan: Plan, bucket: string, nowMs: number) {
  const w = windowIndex(nowMs, CONFIG.windowDays);
  const key = `${apiKey}|${plan}|${bucket}|${w}`;
  const resetAt = nowMs + msUntilWindowEnd(nowMs, CONFIG.windowDays);
  return { key, resetAt };
}

/** core check+count */
function checkAndBump(apiKey: string, plan: Plan, bucket: string): { ok: true } | {
  ok: false; resetAfterMs: number; used: number; limit: number; plan: Plan;
} {
  const now = Date.now();
  const { key, resetAt } = bucketKey(apiKey, plan, bucket, now);

  const limits = CONFIG.limits[plan] || CONFIG.limits.free;
  const limit = Math.max(0, limits.dailyFindBuyers);

  if (limit === 0) {
    return { ok: false, resetAfterMs: msUntilWindowEnd(now, CONFIG.windowDays), used: 0, limit, plan };
  }

  const cur = usage.get(key) || { used: 0, resetAt };
  // window rollover guard
  if (cur.resetAt !== resetAt) {
    cur.used = 0;
    cur.resetAt = resetAt;
  }

  if (cur.used >= limit) {
    return { ok: false, resetAfterMs: Math.max(0, cur.resetAt - now), used: cur.used, limit, plan };
  }

  cur.used += 1;
  usage.set(key, cur);
  return { ok: true };
}

/** -----------------------------------------------------------------------
 *  middleware factory
 *  - default export for `import quota from "./middleware/quota"`
 *  - also available as a named export: `import { quota } from ...`
 *  - accepts an optional partial config; `plans` alias is accepted too
 * ----------------------------------------------------------------------*/
export function quota(partial?: Partial<QuotaConfig> & { plans?: PlanMap<PlanLimits> }) {
  // allow both `limits` and legacy `plans` names
  if (partial && (partial as any).plans && !partial.limits) {
    (partial as any).limits = (partial as any).plans;
  }
  if (partial) {
    CONFIG = {
      ...CONFIG,
      ...partial,
      limits: partial.limits ? { ...CONFIG.limits, ...partial.limits } : CONFIG.limits,
    };
  }

  // express handler
  return function quotaMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      if (CONFIG.disabled) return next(); // hard-off

      const { apiKey, plan } = resolveIdentity(req);

      // 'internal' is effectively unlimited
      if (plan === "internal") return next();

      // this middleware is intended to be mounted specifically on the
      // /find-buyers route; still, keep the bucket name explicit:
      const bucket = "find-buyers";

      const r = checkAndBump(apiKey, plan, bucket);
      if (r.ok) return next();

      res.status(429).json({
        ok: false,
        error: "DAILY_QUOTA",
        plan: r.plan,
        limit: r.limit,
        retryAfterMs: r.resetAfterMs,
      });
    } catch (err) {
      // never break the route because of quota bugs
      next(err);
    }
  };
}

/** default export for `import quota from ...` */
export default quota;

/** -------- optional admin/testing helpers (named exports) ---------------- */

/** tweak config at runtime (e.g., from tests) */
export function configureQuota(partial?: Partial<QuotaConfig> & { plans?: PlanMap<PlanLimits> }) {
  quota(partial); // reuse merge logic
}

/** bind a plan to a specific API key */
export function setPlanForApiKey(apiKey: string, plan: Plan) {
  if (!apiKey) return;
  planForApiKey.set(apiKey, plan);
}

/** drop all counters (or one apiKey if provided) */
export function resetQuota(apiKey?: string) {
  if (!apiKey) {
    usage.clear();
    return;
  }
  // remove only keys that start with given apiKey
  const prefix = `${apiKey}|`;
  for (const k of usage.keys()) {
    if (k.startsWith(prefix)) usage.delete(k);
  }
}

/** snapshot for debugging/observability */
export function snapshotQuota() {
  const out: Array<{ key: string; used: number; resetAt: number }> = [];
  for (const [key, v] of usage.entries()) out.push({ key, used: v.used, resetAt: v.resetAt });
  return {
    config: CONFIG,
    entries: out.sort((a, b) => a.key.localeCompare(b.key)),
  };
}