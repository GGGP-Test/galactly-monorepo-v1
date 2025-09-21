// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/** One plan’s limits (we count find-buyer calls/day for now). */
export type PlanSpec = {
  /** Max number of POST /find-buyers calls within the window. */
  dailyCalls: number;
};

/** Limits for each plan. */
export type PlanLimits = {
  free: PlanSpec;
  pro: PlanSpec;
};

/** Quota window + plan limits.  We allow a few legacy keys so object
 *  literals in callers never break the type checker. */
export type QuotaConfig = {
  /** Number of whole days in one window. Default: 1 day. */
  windowDays: number;
  /** Per-plan limits (preferred). */
  plans: PlanLimits;

  // ---- legacy / compatibility keys (not used but accepted) ----
  free?: number;
  pro?: number;
  freeHot?: number;
  proHot?: number;
  freeTotal?: number;
  proTotal?: number;
};

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  plans: {
    free: { dailyCalls: 3 },   // <= change here for Free plan daily calls
    pro:  { dailyCalls: 200 }, // sensible default for paid
  },
};

/** internal per-key bucket (in-memory) */
type Bucket = { start: number; used: number };
const buckets = new Map<string, Bucket>();

function getBucket(key: string, windowDays: number) {
  const now = Date.now();
  const windowMs = Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    b = { start: now, used: 0 };
    buckets.set(key, b);
  }
  return { bucket: b, resetAt: b.start + windowMs };
}

function resolvePlan(req: Request): keyof PlanLimits {
  // If you ever tag pro users, set header `x-plan: pro` or similar.
  const hdr = String(req.headers["x-plan"] || "").toLowerCase().trim();
  return hdr === "pro" ? "pro" : "free";
}

function keyFromReq(req: Request) {
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  if (apiKey) return `key:${apiKey}`;
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket && (req.socket as any).remoteAddress) ||
    req.ip ||
    "unknown";
  return `anon:${ip}`;
}

/** Quota middleware. Counts POSTs to /find-buyers once per call. */
export default function quota(opts: Partial<QuotaConfig> = {}) {
  // deep-merge defaults
  const cfg: QuotaConfig = {
    ...DEFAULTS,
    ...opts,
    plans: {
      ...DEFAULTS.plans,
      ...(opts.plans || {}),
      free: { ...DEFAULTS.plans.free, ...(opts.plans?.free || {}) },
      pro:  { ...DEFAULTS.plans.pro,  ...(opts.plans?.pro || {}) },
    },
  };

  return (req: Request, res: Response, next: NextFunction) => {
    // Only gate the creation endpoint
    if (!(req.method === "POST" && /\/find-buyers$/.test(req.path))) {
      return next();
    }

    const plan = resolvePlan(req);
    const key = keyFromReq(req);
    const { bucket, resetAt } = getBucket(key, cfg.windowDays);
    const limit = cfg.plans[plan].dailyCalls;
    const remaining = Math.max(0, limit - bucket.used);

    // annotate headers so the front-end can show remaining quota if desired
    res.setHeader("X-Quota-Plan", plan);
    res.setHeader("X-Quota-Used", String(bucket.used));
    res.setHeader("X-Quota-Limit", String(limit));
    res.setHeader("X-Quota-Remaining", String(remaining));
    res.setHeader("X-Quota-Reset", new Date(resetAt).toISOString());

    if (remaining <= 0) {
      const retryAfterSec = Math.max(1, Math.round((resetAt - Date.now()) / 1000));
      return res
        .status(429)
        .json({ ok: false, error: "QUOTA_EXCEEDED", retryAfterSec });
    }

    // charge one call and continue
    bucket.used += 1;
    next();
  };
}

// also export the types so `import { PlanLimits }` works if needed
export type { QuotaConfig as QuotaConfigType };