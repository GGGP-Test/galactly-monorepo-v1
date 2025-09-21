// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Plans we support.
 * - "free": public free tier
 * - "pro": paid tier
 * - "internal": unlimited/testing bypass (for CI, smoke tests, your key, etc.)
 */
export type Plan = "free" | "pro" | "internal";

export interface PlanLimit {
  /** number of request credits allowed in the window (e.g., POST /find-buyers calls) */
  dailyRequests: number;
}

export interface QuotaConfig {
  /** sliding window in whole days (1 = calendar day bucket) */
  windowDays: number;
  /** per-plan limits */
  limits: Record<Plan, PlanLimit>;
}

/** Default: 3 credits/day for free, generous for pro, unlimited-ish for internal */
const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  limits: {
    free: { dailyRequests: 3 },
    pro: { dailyRequests: 10_000 },
    internal: { dailyRequests: Number.MAX_SAFE_INTEGER },
  },
};

/** Live config (mutated by configureQuota) */
const CFG: QuotaConfig = structuredClone
  ? structuredClone(DEFAULTS)
  : JSON.parse(JSON.stringify(DEFAULTS));

/** Per-API-key plan overrides (e.g., setPlanForApiKey) */
const PLAN_OVERRIDES = new Map<string, Plan>();

/** Simple in-memory usage store */
type Usage = { dateKey: string; used: number };
const USAGE = new Map<string, Usage>(); // key -> usage

const dayKey = (d = new Date()): string => {
  // UTC day because your deploys are global
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  // Support windowDays > 1 by bucketing on the window start day
  if (CFG.windowDays <= 1) return `${yyyy}-${mm}-${dd}`;
  const start = new Date(Date.UTC(yyyy, d.getUTCMonth(), d.getUTCDate()));
  const ms = start.getTime() - ((start.getUTCDay() % CFG.windowDays) * 24 * 3600 * 1000);
  const slot = new Date(ms);
  const sm = String(slot.getUTCMonth() + 1).padStart(2, "0");
  const sd = String(slot.getUTCDate()).padStart(2, "0");
  return `${slot.getUTCFullYear()}-${sm}-${sd}/w${CFG.windowDays}`;
};

const parseCsv = (s?: string | null) =>
  (s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

/** Identify caller key (API key first; otherwise IP bucket) */
const who = (req: Request): string => {
  const k = (req.headers["x-api-key"] as string | undefined)?.trim();
  if (k) return `key:${k}`;
  // proxy-safe IP-ish value
  const xf = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  if (xf) return `ip:${xf}`;
  return `ip:${req.ip || "unknown"}`;
};

/** Determine caller plan */
const planFor = (id: string): Plan => {
  // If it's an API key bucket, check overrides, else fall back to free.
  if (id.startsWith("key:")) {
    const key = id.slice(4);
    return PLAN_OVERRIDES.get(key) ?? "free";
  }
  return "free";
};

/** Core check+increment */
function takeCredit(id: string): { ok: true; remaining: number; limit: number; resetAt: string } | {
  ok: false; error: "DAILY_QUOTA_EXCEEDED"; remaining: number; limit: number; resetAt: string;
} {
  const today = dayKey();
  const pl = planFor(id);
  const limit = CFG.limits[pl]?.dailyRequests ?? DEFAULTS.limits.free.dailyRequests;

  // Unlimited-ish plan
  if (limit >= Number.MAX_SAFE_INTEGER / 2) {
    return { ok: true, remaining: limit, limit, resetAt: `${today}T23:59:59Z` };
  }

  const u = USAGE.get(id);
  if (!u || u.dateKey !== today) {
    USAGE.set(id, { dateKey: today, used: 1 });
    return { ok: true, remaining: Math.max(0, limit - 1), limit, resetAt: `${today}T23:59:59Z` };
  }

  if (u.used >= limit) {
    return { ok: false, error: "DAILY_QUOTA_EXCEEDED", remaining: 0, limit, resetAt: `${today}T23:59:59Z` };
  }

  u.used += 1;
  return { ok: true, remaining: Math.max(0, limit - u.used), limit, resetAt: `${today}T23:59:59Z` };
}

/** Express middleware */
export function quota(): RequestHandler {
  // Bootstrap internal/test keys from env once
  const testKeys = parseCsv(process.env.TEST_API_KEYS);
  for (const k of testKeys) PLAN_OVERRIDES.set(k, "internal");

  const proKeys = parseCsv(process.env.PRO_API_KEYS);
  for (const k of proKeys) PLAN_OVERRIDES.set(k, "pro");

  return (req: Request, res: Response, next: NextFunction) => {
    const id = who(req);
    const r = takeCredit(id);
    if (r.ok) {
      res.setHeader("x-quota-limit", String(r.limit));
      res.setHeader("x-quota-remaining", String(r.remaining));
      res.setHeader("x-quota-reset", r.resetAt);
      return next();
    }
    res.status(429).json({
      ok: false,
      error: r.error,
      limit: r.limit,
      remaining: r.remaining,
      resetAt: r.resetAt,
    });
  };
}

/** Change live config at runtime (safe subset). */
export function configureQuota(partial?: Partial<QuotaConfig> & {
  limits?: Partial<Record<Plan, Partial<PlanLimit>>>;
}): QuotaConfig {
  if (partial?.windowDays && Number.isFinite(partial.windowDays)) {
    CFG.windowDays = Math.max(1, Math.floor(partial.windowDays));
  }
  if (partial?.limits) {
    for (const p of Object.keys(partial.limits) as Plan[]) {
      CFG.limits[p] = {
        ...CFG.limits[p],
        ...(partial.limits[p] || {}),
      } as PlanLimit;
    }
  }
  return JSON.parse(JSON.stringify(CFG));
}

/** Force a specific plan for a given API key (used for tests or overrides). */
export function setPlanForApiKey(apiKey: string, plan: Plan): void {
  if (!apiKey) return;
  PLAN_OVERRIDES.set(apiKey, plan);
}

/** Clear usage counters; if apiKey omitted, clears all. Returns number of buckets cleared. */
export function resetQuota(apiKey?: string): number {
  if (!apiKey) {
    const n = USAGE.size;
    USAGE.clear();
    return n;
  }
  const key = `key:${apiKey}`;
  return Number(USAGE.delete(key));
}

/** Snapshot (for metrics/diagnostics) */
export function snapshotQuota(): {
  config: QuotaConfig;
  overrides: Array<{ apiKey: string; plan: Plan }>;
  usage: Array<{ id: string; used: number; dateKey: string }>;
} {
  const overrides = Array.from(PLAN_OVERRIDES.entries()).map(([k, v]) => ({ apiKey: k, plan: v }));
  const usage = Array.from(USAGE.entries()).map(([id, u]) => ({ id, used: u.used, dateKey: u.dateKey }));
  return {
    config: JSON.parse(JSON.stringify(CFG)),
    overrides,
    usage,
  };
}