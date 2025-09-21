// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

export type Plan = "free" | "pro" | "internal";

export interface QuotaConfig {
  /** size of the quota window in whole/partial days (default: 1 day) */
  windowDays?: number;
  /** max requests per window for free users (default: 3) */
  freeDaily?: number;
  /** max requests per window for pro users (default: unlimited) */
  proDaily?: number;
  /** accepted but currently not enforced; present so callers can pass it without type errors */
  freeHot?: number;
  /** accepted but currently not enforced; present so callers can pass it without type errors */
  freeWarm?: number;
}

type Entry = {
  windowStart: number;   // ms since epoch
  calls: number;         // requests attempted in the window
  grants: number;        // “successful” actions recorded by onGrantLead()
  plan: Plan;
};

const DEFAULTS: Required<Pick<QuotaConfig, "windowDays" | "freeDaily" | "proDaily">> = {
  windowDays: 1,
  freeDaily: 3,
  proDaily: Number.POSITIVE_INFINITY,
};

// in-memory counters (per deploy instance)
const counters = new Map<string, Entry>();
// optional overrides for API keys (key -> plan)
const planOverride = new Map<string, Plan>();

function nowMs() { return Date.now(); }
function daysToMs(d: number) { return Math.max(1, Math.floor(d * 86_400_000)); }

function clientKey(req: Request) {
  const apiKey = String(req.header("x-api-key") || "").trim();
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || (req.socket?.remoteAddress || "");
  const key = apiKey ? `k:${apiKey}` : `ip:${ip || "unknown"}`;
  return { apiKey, key };
}

/**
 * Quota middleware.
 * Accepts either a bare object with { freeDaily, proDaily, windowDays }
 * or extra, ignored fields like { freeHot, freeWarm } so callers won’t type-fail.
 */
function quota(cfg: Partial<QuotaConfig> = {}): RequestHandler {
  const windowMs = daysToMs(cfg.windowDays ?? DEFAULTS.windowDays);
  const freeDaily = Number.isFinite(cfg.freeDaily) ? Number(cfg.freeDaily) : DEFAULTS.freeDaily;
  const proDaily = Number.isFinite(cfg.proDaily) ? Number(cfg.proDaily) : DEFAULTS.proDaily;

  return (req: Request, res: Response, next: NextFunction) => {
    const { apiKey, key } = clientKey(req);

    // NOTE: treat everyone as "free" unless explicitly overridden to "pro" / "internal"
    const plan: Plan = planOverride.get(apiKey) ?? "free";

    const t = nowMs();
    let entry = counters.get(key);
    if (!entry || (t - entry.windowStart) >= windowMs) {
      entry = { windowStart: t, calls: 0, grants: 0, plan };
      counters.set(key, entry);
    } else {
      // keep latest plan snapshot
      entry.plan = plan;
    }

    const limit = plan === "pro" || plan === "internal" ? proDaily : freeDaily;

    if (entry.calls >= limit) {
      const retryAfterMs = windowMs - (t - entry.windowStart);
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        retryAfterMs,
        plan,
        limit,
        used: entry.calls,
      });
    }

    // count this attempt
    entry.calls += 1;

    // let route handlers optionally record a “grant”
    (res as any).onGrantLead = () => { entry!.grants += 1; };

    next();
  };
}

/** Clear all counters (useful for tests) */
function resetQuota(): void {
  counters.clear();
}

/** Force a plan for a given API key (useful for tests/manual overrides) */
function setPlanForApiKey(apiKey: string, plan: Plan): void {
  if (!apiKey) return;
  planOverride.set(apiKey, plan);
}

/** Introspect current counters for /metrics */
function snapshotQuota() {
  const items = Array.from(counters.entries()).map(([key, e]) => ({
    key,
    plan: e.plan,
    calls: e.calls,
    grants: e.grants,
    windowStart: new Date(e.windowStart).toISOString(),
  }));
  return {
    ok: true,
    now: new Date().toISOString(),
    windowDays: DEFAULTS.windowDays,
    defaults: DEFAULTS,
    items,
  };
}

// Export both named and default so either import style works.
export { quota, resetQuota, setPlanForApiKey, snapshotQuota };
export default quota;