// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Per-plan daily limits (request-level; we count POST /find-buyers calls) */
export interface PlanLimit {
  /** Max number of find-buyers calls per window */
  perDay: number;
  /** After exceeding, how long to cool down before the next attempt is allowed */
  cooldownMs: number;
}

export interface QuotaConfig {
  /** Rolling window size in days (default: 1) */
  windowDays: number;
  /** Limits for free and pro plans */
  limits: {
    free: PlanLimit;
    pro: PlanLimit;
  };
  /**
   * Determine plan for this request. If not provided, uses header x-plan=pro|free,
   * otherwise defaults to 'free'.
   */
  detectPlan?: (req: Request) => "free" | "pro";
  /** Return true to skip quota enforcement (e.g., for tests) */
  bypass?: (req: Request) => boolean;
}

/** In-memory store; fine for a single instance. */
type Record = { windowStart: number; used: number; cooldownUntil: number };
const STORE = new Map<string, Record>();

const DAY = 24 * 60 * 60 * 1000;

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  limits: {
    free: { perDay: 3, cooldownMs: 10_000 },
    pro:  { perDay: 200, cooldownMs: 0 },
  },
};

/** Key derivation: prefer API key; fallback to IP. */
function keyFor(req: Request): string {
  const apiKey = (req.header("x-api-key") || "").trim();
  if (apiKey) return `k:${apiKey}`;
  // trust proxy usually set; we still keep req.ip as fallback
  return `ip:${req.ip || (req.headers["x-forwarded-for"] as string | undefined) || "unknown"}`;
}

function envBypass(req: Request): boolean {
  // If TEST_API_KEY is set, any request carrying that x-api-key will bypass quota.
  const testKey = (process.env.TEST_API_KEY || "").trim();
  if (testKey && (req.header("x-api-key") || "").trim() === testKey) return true;

  // Optional second bypass channel: header token, guarded by ALLOW_TEST_BYPASS.
  if (process.env.ALLOW_TEST_BYPASS === "1") {
    const token = (process.env.TEST_BYPASS_TOKEN || "").trim();
    if (token && (req.header("x-test-bypass") || "").trim() === token) return true;
  }
  return false;
}

/** Merge config shallowly and keep shapes stable for TS */
function normalize(partial?: Partial<QuotaConfig>): QuotaConfig {
  const base = DEFAULTS;
  const p = partial || {};
  return {
    windowDays: typeof p.windowDays === "number" ? p.windowDays : base.windowDays,
    limits: {
      free: {
        perDay: p.limits?.free?.perDay ?? base.limits.free.perDay,
        cooldownMs: p.limits?.free?.cooldownMs ?? base.limits.free.cooldownMs,
      },
      pro: {
        perDay: p.limits?.pro?.perDay ?? base.limits.pro.perDay,
        cooldownMs: p.limits?.pro?.cooldownMs ?? base.limits.pro.cooldownMs,
      },
    },
    detectPlan: p.detectPlan ?? base.detectPlan,
    bypass: p.bypass ?? base.bypass,
  };
}

/**
 * Quota middleware factory. Call with zero or one argument.
 * - quota() -> use defaults (free: 3/day; pro: 200/day)
 * - quota({ limits: { free: { perDay: 4, cooldownMs: 8_000 } } })
 */
export function quota(partial?: Partial<QuotaConfig>): RequestHandler {
  const cfg = normalize(partial);

  return function quotaMiddleware(req: Request, res: Response, next: NextFunction) {
    // Bypass for tests/dev if configured
    if (envBypass(req) || (cfg.bypass && cfg.bypass(req))) return next();

    const plan: "free" | "pro" =
      (cfg.detectPlan && cfg.detectPlan(req)) ||
      ((req.header("x-plan") || "").toLowerCase() === "pro" ? "pro" : "free");

    const limit = plan === "pro" ? cfg.limits.pro : cfg.limits.free;
    const key = `${plan}:${keyFor(req)}`;
    const now = Date.now();

    const windowMs = cfg.windowDays * DAY;
    let rec = STORE.get(key);
    if (!rec || now - rec.windowStart >= windowMs) {
      rec = { windowStart: now, used: 0, cooldownUntil: 0 };
      STORE.set(key, rec);
    }

    if (rec.cooldownUntil && now < rec.cooldownUntil) {
      return res.status(429).json({
        ok: false,
        error: "COOLDOWN",
        retryAfterMs: rec.cooldownUntil - now,
        windowEndsAt: new Date(rec.windowStart + windowMs).toISOString(),
      });
    }

    if (rec.used >= limit.perDay) {
      rec.cooldownUntil = now + (limit.cooldownMs || 0);
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        limit: limit.perDay,
        used: rec.used,
        retryAfterMs: limit.cooldownMs || 0,
        windowEndsAt: new Date(rec.windowStart + windowMs).toISOString(),
      });
    }

    rec.used += 1;
    return next();
  };
}

/** Test-only: GET a snapshot of the in-memory counters. */
export const snapshotQuota: RequestHandler = (req, res) => {
  if (process.env.ALLOW_TEST_BYPASS !== "1") return res.status(404).end();
  const out: Record<string, Record> = {};
  for (const [k, v] of STORE.entries()) out[k] = { ...v };
  res.json({ ok: true, store: out, size: STORE.size });
};

/** Test-only: POST reset; clears all or a specific key by API key / IP */
export const resetQuota: RequestHandler = (req, res) => {
  if (process.env.ALLOW_TEST_BYPASS !== "1") return res.status(404).end();

  const target = (req.query.key as string | undefined)?.trim();
  if (!target) {
    STORE.clear();
    return res.json({ ok: true, cleared: "all", size: STORE.size });
  }

  // delete both free/pro variants for the given api key or ip
  const candidates = [`free:k:${target}`, `pro:k:${target}`, `free:ip:${target}`, `pro:ip:${target}`];
  let n = 0;
  for (const c of candidates) if (STORE.delete(c)) n++;
  res.json({ ok: true, cleared: n });
};

// also export default to permit `import quota from "./middleware/quota"`
export default quota;