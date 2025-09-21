// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Plans we recognize. "test" is a built-in bypass for your own testing.
 */
export type Plan = "free" | "pro" | "test";

export interface PlanLimits {
  /** requests per rolling window (we use day-long windows for now) */
  daily: number;
}

export interface QuotaConfig {
  /** window size in days (integer). default 1 (i.e., per-day) */
  windowDays: number;
  /** per-plan limits */
  limits: {
    free: PlanLimits;
    pro: PlanLimits;
    test: PlanLimits;
  };
}

/**
 * Very conservative defaults:
 *  - free: 3/day (what you asked for)
 *  - pro: high enough to be a non-issue for now
 *  - test: "effectively unlimited" so you can click around
 *
 * You can override via env without touching code:
 *  QUOTA_FREE_DAILY, QUOTA_PRO_DAILY, QUOTA_TEST_DAILY, QUOTA_WINDOW_DAYS
 */
function buildDefaultsFromEnv(): QuotaConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    windowDays: num(process.env.QUOTA_WINDOW_DAYS, 1),
    limits: {
      free: { daily: num(process.env.QUOTA_FREE_DAILY, 3) },
      pro: { daily: num(process.env.QUOTA_PRO_DAILY, 10000) },
      test: { daily: num(process.env.QUOTA_TEST_DAILY, 1_000_000) }
    }
  };
}

/** in-memory usage store; resets with process restarts */
interface Usage {
  windowStartMs: number;
  used: number;
  plan: Plan;
}
const store: { [actorKey: string]: Usage } = {};
/** Optional plan mapping for specific API keys */
const planForApiKey: { [apiKey: string]: Plan } = {};

/** Helpers */
function now() { return Date.now(); }

function getActorKey(req: Request): string {
  const apiKey = (req.get("x-api-key") || "").trim();
  // include plan in the actor key so a single key can be switched across plans safely
  const plan = getPlan(req, apiKey);
  const ip = (req.ip || req.socket.remoteAddress || "anon").toString();
  return (apiKey ? `key:${apiKey}` : `ip:${ip}`) + `|plan:${plan}`;
}

function getPlan(req: Request, apiKey: string): Plan {
  // 1) explicit mapping (setPlanForApiKey)
  if (apiKey && planForApiKey[apiKey]) return planForApiKey[apiKey];

  // 2) TEST_API_KEY bypass
  if (apiKey && process.env.TEST_API_KEY && apiKey === process.env.TEST_API_KEY) return "test";

  // 3) allow overriding with header for admin/manual tests (not documented to users)
  const h = (req.get("x-plan") || "").toLowerCase();
  if (h === "test" || h === "pro" || h === "free") return h as Plan;

  // 4) default everyone to FREE unless you wire real billing later
  return "free";
}

/**
 * quota() returns an Express middleware that enforces a per-day request limit
 * by (api key || IP) and plan. Keep it simple and predictable.
 */
export function quota(config?: Partial<QuotaConfig>): RequestHandler {
  const defaults = buildDefaultsFromEnv();
  const windowDays = config?.windowDays ?? defaults.windowDays;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const limits: QuotaConfig["limits"] = {
    free: { daily: config?.limits?.free?.daily ?? defaults.limits.free.daily },
    pro:  { daily: config?.limits?.pro?.daily  ?? defaults.limits.pro.daily  },
    test: { daily: config?.limits?.test?.daily ?? defaults.limits.test.daily }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req.get("x-api-key") || "").trim();
    const plan = getPlan(req, apiKey);
    const limit = limits[plan].daily;

    // Test plan has effectively no limit
    if (plan === "test") {
      return next();
    }

    const actorKey = getActorKey(req);
    const u = store[actorKey];

    if (!u || now() - u.windowStartMs >= windowMs) {
      store[actorKey] = { windowStartMs: now(), used: 0, plan };
    }

    const usage = store[actorKey];
    if (usage.used >= limit) {
      const retryAfterMs = usage.windowStartMs + windowMs - now();
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({
        ok: false,
        error: "QUOTA_DAILY",
        plan,
        used: usage.used,
        limit,
        retryAfterMs
      });
    }

    usage.used += 1;
    return next();
  };
}

/** --- Testing/observability helpers (named exports on purpose) --- */

/** Clear all counters (useful during local/dev testing) */
export function resetQuota(): void {
  for (const k in store) delete store[k];
}

/** Take a lightweight snapshot for /metrics or debugging */
export function snapshotQuota() {
  const out: Array<{ actor: string; used: number; plan: Plan; windowEndsInMs: number }> = [];
  for (const k in store) {
    const row = store[k];
    out.push({
      actor: k,
      used: row.used,
      plan: row.plan,
      windowEndsInMs: Math.max(0, row.windowStartMs + 24 * 60 * 60 * 1000 - now())
    });
  }
  return { ok: true, count: out.length, items: out };
}

/** Force a plan for a specific api key (for quick manual tests) */
export function setPlanForApiKey(apiKey: string, plan: Plan): void {
  if (!apiKey) return;
  planForApiKey[apiKey] = plan;
}