// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Which plan a caller is on. */
export type PlanId = "free" | "pro";

/** Per-plan limits for a single rolling window. */
export type PlanLimits = {
  /** Max number of /find-buyers calls in the window. */
  callsPerWindow: number;
};

/** Config for the quota middleware. */
export interface QuotaConfig {
  /** Size of the rolling window, in whole days. Default: 1 (24h). */
  windowDays: number;
  /** Per-plan limits. */
  plans: Record<PlanId, PlanLimits>;
  /** Header that carries the API key. Default: x-api-key. */
  keyHeader: string;
  /** Header that, if present, bypasses quota for testing. Default: x-test-mode. */
  testBypassHeader: string;
  /** API keys that should be treated as PRO (optional). */
  proKeys: string[];
  /** Optionally allow a header to force plan (e.g., "pro" for testing). Default: x-plan. */
  planHeader: string;
}

/** In-memory counters (OK for now; swap to Redis later). */
type Bucket = { startedAt: number; used: number };
const store = new Map<string, Bucket>();

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  plans: {
    free: { callsPerWindow: 3 },        // <= Free plan: 3 calls / day
    pro:  { callsPerWindow: 250 },      // <= Pro plan: plenty
  },
  keyHeader: "x-api-key",
  testBypassHeader: "x-test-mode",
  proKeys: [],
  planHeader: "x-plan",
};

function now() { return Date.now(); }

/** Merge shallow config objects. */
function merge<T extends object>(base: T, o?: Partial<T>): T {
  return Object.assign({}, base, o ?? {}) as T;
}

/** Resolve caller plan from headers/config. */
function resolvePlan(req: Request, cfg: QuotaConfig, apiKey: string): PlanId {
  const forced = String(req.header(cfg.planHeader) || "").toLowerCase();
  if (forced === "pro") return "pro";
  if (cfg.proKeys.includes(apiKey)) return "pro";
  return "free";
}

/** Public factory: returns an Express middleware that enforces per-plan quotas. */
export function withQuota(partial?: Partial<QuotaConfig>): RequestHandler {
  const cfg: QuotaConfig = {
    ...DEFAULTS,
    ...partial,
    // deep-merge for `plans`
    plans: merge(DEFAULTS.plans, partial?.plans),
  };

  const windowMs = Math.max(1, Math.floor(cfg.windowDays)) * 24 * 60 * 60 * 1000;

  const mw: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    // Dev/test bypass
    if (req.header(cfg.testBypassHeader)) return next();

    const apiKey = String(req.header(cfg.keyHeader) || "").trim() || "anon";
    const plan: PlanId = resolvePlan(req, cfg, apiKey);
    const limit = cfg.plans[plan].callsPerWindow;

    const bucketKey = `${plan}:${apiKey}`;
    const b = store.get(bucketKey);
    const t = now();

    let bucket: Bucket;
    if (!b || t - b.startedAt >= windowMs) {
      bucket = { startedAt: t, used: 0 };
      store.set(bucketKey, bucket);
    } else {
      bucket = b;
    }

    // headers (helpful for UI)
    res.setHeader("X-Quota-Plan", plan);
    res.setHeader("X-Quota-Limit", String(limit));
    res.setHeader("X-Quota-Used", String(bucket.used));
    res.setHeader("X-Quota-Reset-At", new Date(bucket.startedAt + windowMs).toISOString());

    if (bucket.used >= limit) {
      const retryAfterMs = bucket.startedAt + windowMs - t;
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        plan,
        limit,
        used: bucket.used,
        retryAfterMs,
        resetAt: new Date(bucket.startedAt + windowMs).toISOString(),
      });
    }

    bucket.used += 1;
    next();
  };

  return mw;
}

/** Small test helper so you can clear counters without restarting the pod. */
export function _resetQuotaFor(keyOrPlanKey?: string) {
  if (!keyOrPlanKey) { store.clear(); return; }
  for (const k of Array.from(store.keys())) if (k.endsWith(`:${keyOrPlanKey}`) || k === keyOrPlanKey) store.delete(k);
}

export default withQuota;