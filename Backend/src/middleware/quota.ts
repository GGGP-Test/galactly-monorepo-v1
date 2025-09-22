// src/middleware/quota.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Plans we recognize. Add here first if you introduce a new one.
 */
export type Plan = "free" | "pro" | "test" | "internal";

/**
 * Per-plan limits (right now only daily).
 */
export interface PlanLimits {
  daily: number;
}

/**
 * Quota configuration (window + per-plan limits + flags).
 */
export interface QuotaConfig {
  windowDays: number;                              // e.g., 1 day rolling window
  limits: { [P in Plan]: PlanLimits };             // avoid TS's Record<> to keep compilers happy
  allowTest: boolean;                              // allow the special test key to work
  testApiKey?: string;                             // value of QUOTA_TEST_API_KEY
  disable?: boolean;                               // hard bypass
}

/** In-memory ledger entry. */
interface Bucket {
  count: number;
  windowId: number; // day bucket id (windowDays granularity)
}

/** State */
let CONFIG: QuotaConfig = defaultConfigFromEnv();
const store = new Map<string, Bucket>();
const planOverride = new Map<string, Plan>(); // apiKey -> plan
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

/** Build sane defaults from env. */
function defaultConfigFromEnv(): QuotaConfig {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  const bool = (v: string | undefined) => v === "1" || String(v).toLowerCase() === "true";

  const windowDays = Math.max(1, n(process.env.QUOTA_WINDOW_DAYS, 1));

  const limits: QuotaConfig["limits"] = {
    free:     { daily: n(process.env.FREE_DAILY, 3) },
    pro:      { daily: n(process.env.PRO_DAILY, 25) },
    test:     { daily: n(process.env.TEST_DAILY, 100) },
    internal: { daily: n(process.env.INT_DAILY, 1000) },
  };

  return {
    windowDays,
    limits,
    allowTest: bool(process.env.ALLOW_TEST),
    testApiKey: process.env.QUOTA_TEST_API_KEY || undefined,
    disable: bool(process.env.QUOTA_DISABLE),
  };
}

/**
 * Update configuration at runtime (idempotent).
 * Pass only the keys you want to change.
 */
export function configureQuota(partial?: Partial<QuotaConfig>): void {
  if (!partial) return;
  CONFIG = {
    ...CONFIG,
    ...partial,
    limits: partial.limits ? { ...CONFIG.limits, ...partial.limits } as QuotaConfig["limits"] : CONFIG.limits,
  };
}

/** Admin/testing helpers (optional) */
export function setPlanForApiKey(apiKey: string, plan: Plan): void {
  if (!apiKey) return;
  planOverride.set(apiKey, plan);
}
export function resetQuota(): void { store.clear(); }
export function snapshotQuota(): Array<{ key: string; count: number; windowId: number }> {
  const arr: Array<{ key: string; count: number; windowId: number }> = [];
  for (const [key, b] of store.entries()) arr.push({ key, count: b.count, windowId: b.windowId });
  return arr;
}

/**
 * Decide the plan for this request.
 * Rules:
 *  - Admin token (x-admin-token) -> "internal"
 *  - If there is an override for this apiKey -> that plan
 *  - If allowTest && apiKey == testApiKey -> "test"
 *  - Else "pro" only if caller explicitly says x-plan: pro AND has apiKey (you can tighten later)
 *  - Else "free"
 */
function resolvePlan(req: Request, apiKey: string | undefined): Plan {
  const t = req.header("x-admin-token") || "";
  if (t && ADMIN_TOKEN && t === ADMIN_TOKEN) return "internal";

  if (apiKey && planOverride.has(apiKey)) return planOverride.get(apiKey)!;

  if (CONFIG.allowTest && apiKey && CONFIG.testApiKey && apiKey === CONFIG.testApiKey) {
    return "test";
  }

  const asked = (req.header("x-plan") || req.query.plan || "").toString().toLowerCase();
  if (asked === "pro" && apiKey) return "pro";

  return "free";
}

/** Compute the current window id (integer) for the rolling window. */
function windowId(nowMs: number, windowDays: number): number {
  const day = Math.floor(nowMs / 86_400_000); // 24h
  return Math.floor(day / Math.max(1, windowDays));
}

/** Build a stable bucket id. */
function bucketId(plan: Plan, apiKey: string | undefined, ip: string, wId: number): string {
  // For free/no-key users, we bucket by IP to avoid unlimited anonymous spam.
  const subject = apiKey || `ip:${ip}`;
  return `${plan}:${subject}:w${wId}`;
}

/**
 * Express middleware enforcing per-day quotas by plan.
 * Sets helpful headers:
 *   x-quota-plan, x-quota-remaining, x-quota-limit, x-quota-reset
 */
export function quota(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (CONFIG.disable) return next();

    const now = Date.now();
    const wId = windowId(now, CONFIG.windowDays);

    const rawKey = (req.header("x-api-key") || "").trim();
    const apiKey = rawKey.length ? rawKey : undefined;

    const plan = resolvePlan(req, apiKey);
    const limit = CONFIG.limits[plan]?.daily ?? 0;

    const id = bucketId(plan, apiKey, req.ip || req.socket.remoteAddress || "0.0.0.0", wId);
    let bucket = store.get(id);
    if (!bucket || bucket.windowId !== wId) {
      bucket = { count: 0, windowId: wId };
      store.set(id, bucket);
    }

    // write headers for observability
    res.setHeader("x-quota-plan", plan);
    res.setHeader("x-quota-limit", String(limit));
    res.setHeader("x-quota-remaining", String(Math.max(0, limit - bucket.count)));
    res.setHeader("x-quota-reset", String((wId + 1) * CONFIG.windowDays * 86_400_000)); // rough epoch ms

    if (bucket.count >= limit) {
      return res.status(429).json({
        ok: false,
        error: "QUOTA_EXCEEDED",
        plan,
        remaining: 0,
        resetAtMs: Number(res.getHeader("x-quota-reset")),
      });
    }

    bucket.count += 1;
    next();
  };
}