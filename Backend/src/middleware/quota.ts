// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/** One plan’s limits (we count successful find-buyer calls/day). */
export type PlanSpec = {
  /** Max number of POST /find-buyers calls within the window. */
  dailyCalls: number;
};

/** Limits for each plan. */
export type PlanLimits = {
  free: PlanSpec;
  pro: PlanSpec;
};

/** Cooldown / abuse controls (escalates on repeated violations). */
export type PenaltyCfg = {
  /** How many violations inside window trigger a cooldown. Default: 3 */
  threshold: number;
  /** Rolling window used for counting violations. Default: 30s */
  windowMs: number;
  /** Base cooldown applied after first threshold breach. Default: 60s */
  baseCooldownMs: number;
  /** Maximum cooldown cap. Default: 15 minutes */
  maxCooldownMs: number;
  /** Optional: permanently ban after this many cooldowns. */
  banAfter?: number;
};

/** Quota window + plan limits. */
export type QuotaConfig = {
  /** Number of whole days in one window. Default: 1 */
  windowDays: number;
  /** Per-plan limits (preferred). */
  plans: PlanLimits;
  /** Abuse/cooldown settings. */
  penalty?: PenaltyCfg;

  // ---- legacy / compatibility keys (ignored but allowed) ----
  free?: number;
  pro?: number;
  freeHot?: number;
  proHot?: number;
  freeTotal?: number;
  proTotal?: number;
};

const DEFAULTS: Required<Pick<QuotaConfig, "windowDays" | "plans">> & {
  penalty: PenaltyCfg;
} = {
  windowDays: 1,
  plans: {
    free: { dailyCalls: 3 },
    pro: { dailyCalls: 200 },
  },
  penalty: {
    threshold: 3,
    windowMs: 30_000,
    baseCooldownMs: 60_000,
    maxCooldownMs: 15 * 60_000,
    banAfter: undefined,
  },
};

/** internal per-key daily bucket */
type Bucket = { start: number; used: number };
/** internal per-key abuse tracker */
type Abuse = {
  strikes: number;
  windowStart: number;
  cooldownUntil: number; // ms timestamp; 0 = none
  cooldownCount: number; // how many cooldowns previously applied
};

const buckets = new Map<string, Bucket>();
const abuses = new Map<string, Abuse>();

function nowMs() {
  return Date.now();
}

function getBucket(key: string, windowDays: number) {
  const t = nowMs();
  const windowMs = Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
  let b = buckets.get(key);
  if (!b || t - b.start >= windowMs) {
    b = { start: t, used: 0 };
    buckets.set(key, b);
  }
  return { bucket: b, resetAt: b.start + windowMs };
}

function getAbuse(key: string, p: PenaltyCfg) {
  const t = nowMs();
  let a = abuses.get(key);
  if (!a) {
    a = { strikes: 0, windowStart: t, cooldownUntil: 0, cooldownCount: 0 };
    abuses.set(key, a);
  }
  // roll the strike window
  if (t - a.windowStart > p.windowMs) {
    a.strikes = 0;
    a.windowStart = t;
  }
  return a;
}

function resolvePlan(req: Request): keyof PlanLimits {
  const hdr = String(req.headers["x-plan"] || "").toLowerCase().trim();
  return hdr === "pro" ? "pro" : "free";
}

function keyFromReq(req: Request) {
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  if (apiKey) return `key:${apiKey}`;
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    (req.socket as any)?.remoteAddress ||
    req.ip ||
    "unknown";
  return `anon:${ip}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/** Quota middleware. Also applies an escalating cooldown when a client keeps
 *  calling after hitting limits. Cooldown doubles each time up to max. */
export default function quota(opts: Partial<QuotaConfig> = {}) {
  const cfg: QuotaConfig = {
    ...DEFAULTS,
    ...opts,
    plans: {
      ...DEFAULTS.plans,
      ...(opts.plans || {}),
      free: { ...DEFAULTS.plans.free, ...(opts.plans?.free || {}) },
      pro: { ...DEFAULTS.plans.pro, ...(opts.plans?.pro || {}) },
    },
    penalty: { ...DEFAULTS.penalty, ...(opts.penalty || {}) },
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

    const abuse = getAbuse(key, cfg.penalty!);
    const t = nowMs();

    // if currently cooling down, block immediately
    if (abuse.cooldownUntil > t) {
      const retryAfterSec = Math.max(1, Math.ceil((abuse.cooldownUntil - t) / 1000));
      setHeaders(res, plan, bucket.used, limit, remaining, resetAt, abuse.cooldownUntil);
      return res.status(429).json({ ok: false, error: "COOLDOWN", retryAfterSec });
    }

    if (remaining <= 0) {
      // quota exceeded: count a strike and maybe start cooldown
      abuse.strikes += 1;

      let startCooldown = false;
      if (abuse.strikes >= (cfg.penalty!.threshold ?? 3)) {
        startCooldown = true;
        abuse.strikes = 0; // reset strikes after applying cooldown
        abuse.windowStart = t;
        // exponential backoff: base * 2^(cooldownCount)
        const ms = clamp(
          cfg.penalty!.baseCooldownMs * Math.pow(2, abuse.cooldownCount),
          cfg.penalty!.baseCooldownMs,
          cfg.penalty!.maxCooldownMs
        );
        abuse.cooldownUntil = t + ms;
        abuse.cooldownCount += 1;
      }

      const retryAfterSec = startCooldown
        ? Math.max(1, Math.ceil((abuse.cooldownUntil - t) / 1000))
        : Math.max(1, Math.ceil((resetAt - t) / 1000));

      setHeaders(res, plan, bucket.used, limit, remaining, resetAt, abuse.cooldownUntil);
      return res
        .status(429)
        .json({
          ok: false,
          error: startCooldown ? "COOLDOWN" : "QUOTA_EXCEEDED",
          retryAfterSec,
        });
    }

    // allowed: charge one unit and clear any minor strike history
    bucket.used += 1;
    if (abuse.strikes > 0) {
      abuse.strikes = 0;
      abuse.windowStart = t;
    }

    setHeaders(res, plan, bucket.used, limit, Math.max(0, limit - bucket.used), resetAt, abuse.cooldownUntil);
    next();
  };
}

function setHeaders(
  res: Response,
  plan: string,
  used: number,
  limit: number,
  remaining: number,
  resetAt: number,
  cooldownUntil: number
) {
  res.setHeader("X-Quota-Plan", plan);
  res.setHeader("X-Quota-Used", String(used));
  res.setHeader("X-Quota-Limit", String(limit));
  res.setHeader("X-Quota-Remaining", String(remaining));
  res.setHeader("X-Quota-Reset", new Date(resetAt).toISOString());
  if (cooldownUntil > 0) res.setHeader("X-Cooldown-Until", new Date(cooldownUntil).toISOString());
}

// also export the types by name so named imports work
export type { QuotaConfig as QuotaConfigType };