// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Supported plans. Keep this tight so we don't fight types all day.
 */
export type Plan = "free" | "pro" | "internal";

export interface PlanLimits {
  /** Max successful calls allowed per UTC day. */
  dailyCalls: number;
  /**
   * Optional cooldown (ms). When a caller hits the daily cap, we can
   * temporarily block further attempts instead of letting them spam.
   */
  cooldownMs?: number;
}

/** Explicit map instead of Record<> to avoid quirky TS lib issues. */
export interface PlanMap {
  free: PlanLimits;
  pro: PlanLimits;
  internal: PlanLimits;
}

export interface QuotaConfig {
  defaultPlan: Plan;
  limits: PlanMap;
}

/** In-memory state per apiKey (or per-IP if no apiKey). */
type KeyState = {
  day: string;         // UTC yyyymmdd
  used: number;        // successful calls today
  cooldownUntil?: number;
};

const state = new Map<string, KeyState>();

/**
 * Optional mapping: specific API keys -> explicit plan.
 * Lets us grant "pro" or "internal" to demo/test keys without inventing a new plan.
 */
const planByApiKey = new Map<string, Plan>();

/** Helpers */
export function setPlanForApiKey(apiKey: string, plan: Plan) {
  if (!apiKey) return;
  planByApiKey.set(apiKey, plan);
}
export function resetQuota(apiKey?: string) {
  if (apiKey) {
    state.delete(apiKey);
  } else {
    state.clear();
  }
}
export function snapshotQuota() {
  const out: Array<{ key: string; day: string; used: number; cooldownUntil?: number }> = [];
  state.forEach((v, k) => out.push({ key: k, day: v.day, used: v.used, cooldownUntil: v.cooldownUntil }));
  return out;
}

/** Small utils */
const todayUTC = () => {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};
const toNum = (v: any, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Build a quota middleware. If called with no args, we read env and use defaults.
 * Env knobs (all optional):
 *   QUOTA_FREE_DAILY, QUOTA_FREE_COOLDOWN_MS
 *   QUOTA_PRO_DAILY,  QUOTA_PRO_COOLDOWN_MS
 *   QUOTA_INTERNAL_DAILY
 *   QUOTA_DEFAULT_PLAN  -> "free" | "pro" | "internal"  (default "free")
 */
export default function quota(partial?: Partial<QuotaConfig>) {
  const cfg: QuotaConfig = {
    defaultPlan: (process.env.QUOTA_DEFAULT_PLAN as Plan) || "free",
    limits: {
      free: {
        dailyCalls: toNum(process.env.QUOTA_FREE_DAILY, 3),
        cooldownMs: toNum(process.env.QUOTA_FREE_COOLDOWN_MS, 0),
      },
      pro: {
        dailyCalls: toNum(process.env.QUOTA_PRO_DAILY, 250),
        cooldownMs: toNum(process.env.QUOTA_PRO_COOLDOWN_MS, 0),
      },
      internal: {
        dailyCalls: toNum(process.env.QUOTA_INTERNAL_DAILY, 100000),
        cooldownMs: 0,
      },
    },
  };

  // Allow exact overrides (keep the shape identical so TS is happy).
  if (partial?.defaultPlan) cfg.defaultPlan = partial.defaultPlan;
  if (partial?.limits) {
    cfg.limits = {
      free: partial.limits.free ?? cfg.limits.free,
      pro: partial.limits.pro ?? cfg.limits.pro,
      internal: partial.limits.internal ?? cfg.limits.internal,
    };
  }

  return function quotaMiddleware(req: Request, res: Response, next: NextFunction) {
    const headerKey = String(req.header("x-api-key") || "").trim();
    const ip =
      (req.headers["cf-connecting-ip"] as string) ||
      req.socket.remoteAddress ||
      (req.ip || "unknown");

    // Caller identity used for quota bookkeeping
    const key = headerKey || `ip:${ip}`;

    // Which plan applies?
    const plan: Plan = (headerKey && planByApiKey.get(headerKey)) || cfg.defaultPlan;
    const limits = cfg.limits[plan];

    // Reset day boundary
    const now = Date.now();
    const utcDay = todayUTC();
    let s = state.get(key);
    if (!s || s.day !== utcDay) {
      s = { day: utcDay, used: 0 };
      state.set(key, s);
    }

    // Cooldown check
    if (s.cooldownUntil && now < s.cooldownUntil) {
      const retryAfterMs = s.cooldownUntil - now;
      return res
        .status(429)
        .json({ ok: false, error: "QUOTA_COOLDOWN", plan, retryAfterMs });
    }

    // Daily budget check
    if (s.used >= limits.dailyCalls) {
      if (limits.cooldownMs && limits.cooldownMs > 0) {
        s.cooldownUntil = now + limits.cooldownMs;
      }
      const msUntilMidnight =
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1, 0, 0, 0) -
        now;
      return res
        .status(429)
        .json({ ok: false, error: "QUOTA_EXCEEDED", plan, retryAfterMs: Math.max(0, msUntilMidnight) });
    }

    // Reserve one unit; if downstream fails you can decrement here if you want
    s.used += 1;
    next();
  };
}

// Also export helpers as named (already above).
export { planByApiKey };