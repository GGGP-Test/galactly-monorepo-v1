// src/middleware/quota.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Plan limits: daily request caps (and optional hot-per-day for future).
 * We enforce `daily`; `hotPerDay` is kept for future “2 warm + 1 hot” logic.
 */
export type Limit = {
  daily: number;
  hotPerDay?: number;
};

export type PlanLimits = {
  free: Limit;
  pro: Limit;
  anon?: Limit; // when no API key, we key by IP
};

export type QuotaConfig = {
  // rolling window days (currently we bucket by UTC day; keep for future)
  windowDays: number;
  // per-plan limits
  plans: PlanLimits;
  // header name carrying api key
  headerKey?: string; // default: x-api-key
  // optional: list of keys that should be treated as pro (fast path)
  proKeys?: string[];
  // bypass controls for testing
  bypassAll?: boolean;      // disables quota entirely
  bypassKey?: string;       // this exact key bypasses
};

/** default plan limits (safe, small) */
export const limits: PlanLimits = {
  free: { daily: 3, hotPerDay: 1 },
  pro:  { daily: 1000, hotPerDay: 1000 },
  anon: { daily: 2 }
};

type Bucket = {
  dayStamp: string;  // YYYY-MM-DD
  total: number;
  hot: number;
};

// in-memory counters; key = `${plan}:${identity}`
const store = new Map<string, Bucket>();

const DAY_MS = 24 * 60 * 60 * 1000;
const todayStamp = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function identityFrom(req: Request, headerKey: string): { plan: "free" | "pro" | "anon"; id: string; apiKey?: string } {
  const apiKey = String(req.header(headerKey) || "").trim();
  if (!apiKey) {
    // anonymous bucket keyed by IP (trusts Express' req.ip which respects proxies if configured)
    return { plan: "anon", id: `ip:${req.ip || "unknown"}` };
  }

  // allow quick promotion via env list
  const proKeys = (process.env.PRO_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
  const isProViaEnv = proKeys.length > 0 && proKeys.includes(apiKey);

  return { plan: isProViaEnv ? "pro" : "free", id: `key:${apiKey}`, apiKey };
}

/** expose current counters (useful for /metrics) */
export function snapshotQuota() {
  const out: Array<{ key: string; dayStamp: string; total: number; hot: number }> = [];
  for (const [key, b] of store.entries()) out.push({ key, dayStamp: b.dayStamp, total: b.total, hot: b.hot });
  return out;
}

/** wipe all counters (use with care) */
export function resetQuota() {
  store.clear();
}

/**
 * Main middleware factory.
 * Accepts Partial<QuotaConfig>. It also accepts `{ limits: PlanLimits }` as a synonym for `{ plans }`
 * to tolerate older call sites.
 */
export function quota(opts?: Partial<QuotaConfig> & { limits?: PlanLimits }): RequestHandler {
  const headerKey = (opts?.headerKey || "x-api-key").toLowerCase();
  const cfg: QuotaConfig = {
    windowDays: typeof opts?.windowDays === "number" ? Math.max(1, opts!.windowDays) : 1,
    plans: opts?.plans || opts?.limits || limits,
    headerKey,
    proKeys: opts?.proKeys || [],
    bypassAll: !!opts?.bypassAll || process.env.QUOTA_BYPASS === "1",
    bypassKey: opts?.bypassKey || process.env.QUOTA_BYPASS_KEY || ""
  };

  // normalize ENV pro keys into config
  const envPro = (process.env.PRO_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (envPro.length) cfg.proKeys = Array.from(new Set([...(cfg.proKeys || []), ...envPro]));

  return (req: Request, res: Response, next: NextFunction) => {
    if (cfg.bypassAll) return next();

    const { plan, id, apiKey } = identityFrom(req, cfg.headerKey || "x-api-key");
    if (cfg.bypassKey && apiKey && apiKey === cfg.bypassKey) return next();

    // choose plan limits
    const planLimits =
      plan === "pro" ? cfg.plans.pro :
      plan === "free" ? cfg.plans.free :
      cfg.plans.anon || limits.anon!;

    // rotate bucket daily
    const key = `${plan}:${id}`;
    const nowStamp = todayStamp();
    let b = store.get(key);
    if (!b || b.dayStamp !== nowStamp) {
      b = { dayStamp: nowStamp, total: 0, hot: 0 };
      store.set(key, b);
    }

    // enforce daily request cap
    if (b.total >= planLimits.daily) {
      // find when the user can try again (next UTC day)
      const msToReset = (new Date(`${b.dayStamp}T00:00:00.000Z`).getTime() + DAY_MS) - Date.now();
      const retryAfterSec = Math.max(1, Math.ceil(msToReset / 1000));
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        plan,
        limit: planLimits.daily,
        remaining: 0,
        resetAt: new Date(Date.now() + msToReset).toISOString(),
        retryAfterSec
      });
    }

    // count this request and continue
    b.total += 1;
    // (Future: if this call produced a “hot” result, downstream can increment b.hot)

    // expose lightweight headers for the panel (or your browser)
    res.setHeader("X-Plan", plan);
    res.setHeader("X-RateLimit-Limit", String(planLimits.daily));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, planLimits.daily - b.total)));
    next();
  };
}

// Provide a default export *and* named exports so either import style compiles.
export default quota;