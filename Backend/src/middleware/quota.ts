// src/middleware/quota.ts
import { Request, Response, NextFunction } from "express";

/**
 * Plans we recognize. Keep "test" and "internal" so old calls in index.ts won't break.
 */
export type Plan = "free" | "pro" | "internal" | "test";

/**
 * Limits we enforce today. Add more metrics later without breaking callers.
 */
export interface PlanLimit {
  /** Max /day for find-buyers endpoint */
  dailyFindBuyers: number;
}

export interface QuotaConfig {
  /** Number of rolling days for the window (1 = reset every UTC day). */
  windowDays: number;
  /** Per-plan limits. Keys optional so you can override just one plan. */
  limits: {
    free?: PlanLimit;
    pro?: PlanLimit;
    internal?: PlanLimit;
    test?: PlanLimit;
  };
}

/** In-memory counters (simple & fast) */
type DayStamp = string; // e.g. "2025-09-21"
interface UsageCounter {
  used: number;
  day: DayStamp;
}
interface UsageMap {
  // metric -> { used, day }
  [metric: string]: UsageCounter;
}
interface KeyUsage {
  // apiKey -> usage per metric
  [apiKey: string]: UsageMap;
}

/** Global, mutable state kept very simple on purpose */
const STATE = {
  cfg: <QuotaConfig>{
    windowDays: 1,
    limits: {
      free: { dailyFindBuyers: 3 },
      pro: { dailyFindBuyers: 1000 },
      internal: { dailyFindBuyers: 1_000_000 },
      test: { dailyFindBuyers: 10_000 }
    }
  },
  usage: <KeyUsage>{},
  plans: <{ [apiKey: string]: Plan }>{}
};

/** Utility: current UTC day stamp */
function todayUTC(): DayStamp {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Configure quotas at runtime (idempotent) */
export function configureQuota(partial?: Partial<QuotaConfig>): void {
  if (!partial) return;
  if (typeof partial.windowDays === "number" && partial.windowDays > 0) {
    STATE.cfg.windowDays = partial.windowDays;
  }
  if (partial.limits) {
    STATE.cfg.limits = {
      ...STATE.cfg.limits,
      ...partial.limits
    };
  }
}

/** Force a plan for an api key (handy for tests or admin) */
export function setPlanForApiKey(apiKey: string, plan: Plan): void {
  STATE.plans[apiKey] = plan;
}

/** Inspect current counters (for debugging) */
export function snapshotQuota(apiKey?: string) {
  if (apiKey) return { apiKey, usage: STATE.usage[apiKey] || {} };
  return { usage: STATE.usage };
}

/** Reset counters for a key (or all) — useful in dev/test */
export function resetQuota(apiKey?: string) {
  if (apiKey) delete STATE.usage[apiKey];
  else STATE.usage = {};
}

/** Extract an api key (or a stable anonymous surrogate) */
function apiKeyFrom(req: Request): string {
  const hdr = (req.headers["x-api-key"] || req.headers["x-apikey"] || "") as string;
  if (hdr && typeof hdr === "string") return hdr.trim();
  // Anonymous caller -> bind to ip+ua to prevent easy abuse
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "0.0.0.0";
  const ua = (req.headers["user-agent"] as string) || "unknown";
  return `anon:${ip}|${ua.slice(0, 40)}`;
}

/** Decide the plan for a key */
function planFor(apiKey: string): Plan {
  if (STATE.plans[apiKey]) return STATE.plans[apiKey];

  // Env overrides:
  // - QUOTA_DISABLE => treat everyone as internal (no cap)
  // - QUOTA_TEST_API_KEYS=key1,key2 => mark those keys as "test"
  if (process.env.QUOTA_DISABLE === "1") return "internal";
  const testKeys = (process.env.QUOTA_TEST_API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (testKeys.includes(apiKey)) return "test";

  // Default free
  return "free";
}

/** Core check/increment for a single metric */
function take(apiKey: string, metric: string, maxPerDay: number) {
  const today = todayUTC();
  const usage = (STATE.usage[apiKey] ||= {});
  const c = (usage[metric] ||= { used: 0, day: today });

  // Reset if window crossed (simple: per-day reset)
  if (c.day !== today) {
    c.day = today;
    c.used = 0;
  }
  c.used += 1;

  const ok = c.used <= maxPerDay;
  return { ok, used: c.used, day: c.day, limit: maxPerDay };
}

/**
 * Quota middleware (default export).
 * It only gates the heavy route(s): /api/v1/leads/find-buyers
 */
export default function quota() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Allow quota off for local/dev without code changes
    if (process.env.QUOTA_DISABLE === "1") return next();

    const path = req.path || req.url || "";
    const method = (req.method || "GET").toUpperCase();

    // Only meter the expensive endpoint to keep things cheap + predictable
    const isFindBuyers =
      (path.includes("/api/v1/leads/find-buyers") || path.endsWith("/find-buyers")) &&
      (method === "POST" || method === "GET");

    if (!isFindBuyers) return next();

    const key = apiKeyFrom(req);
    const plan = planFor(key);

    // get limit
    const limitCfg =
      (STATE.cfg.limits[plan] ||
        STATE.cfg.limits.free || { dailyFindBuyers: 3 }) as PlanLimit;

    const { ok, used, day, limit } = take(key, "find-buyers", limitCfg.dailyFindBuyers);

    if (ok) return next();

    // 429 with very explicit body (panel already understands this shape)
    const resetAt = new Date(`${day}T23:59:59.999Z`).toISOString();
    return res.status(429).json({
      ok: false,
      error: "QUOTA_EXCEEDED",
      plan,
      metric: "find-buyers",
      used,
      limit,
      resetsAt: resetAt
    });
  };
}