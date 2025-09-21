// src/middleware/quota.ts
import type { Request, Response, NextFunction } from "express";

/**
 * Very small, in-memory daily quota gate.
 * - Plans: "free" | "pro" | "test"
 * - Tracks per API key (or per IP if no key).
 * - Window is N days (default: 1 day).
 *
 * NOTE: while we are still on demo leads, anonymous calls (no API key)
 * are treated as "test" by default so you can click freely from the panel.
 * We will flip this before turning on real leads.
 */

export type Plan = "free" | "pro" | "test";

export interface QuotaConfig {
  windowDays: number;
  freeDaily: number;
  proDaily: number;
  testDaily: number;
}

const DEFAULTS: QuotaConfig = {
  windowDays: 1,
  freeDaily: 3,
  proDaily: 10_000,
  testDaily: 5_000, // effectively "no limit" for testing
};

// ---- state (in-memory) -----------------------------------------------------

type Usage = { windowStartMs: number; used: number };
const usageByKey: { [key: string]: Usage } = {};
const planByApiKey: { [key: string]: Plan } = {};

// Until we flip to real leads, allow anonymous to act as "test"
const ANON_IS_TEST = process.env.ALLOW_ANON_TEST !== "0";

function nowMs() {
  return Date.now();
}

function windowMs(days: number) {
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

function getHeader(req: Request, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? "" : (v as string) ?? "";
}

function getApiKey(req: Request): string {
  return getHeader(req, "x-api-key").trim();
}

function planForKey(key: string): Plan {
  if (key && planByApiKey[key]) return planByApiKey[key];
  if (!key) return ANON_IS_TEST ? "test" : "free";
  // quick heuristics (optional)
  if (key.toLowerCase().startsWith("test_")) return "test";
  return "free";
}

function allowedFor(plan: Plan, limits: QuotaConfig): number {
  if (plan === "pro") return limits.proDaily;
  if (plan === "test") return limits.testDaily;
  return limits.freeDaily;
}

// ---- middleware ------------------------------------------------------------

export function quota(partial?: Partial<QuotaConfig>) {
  const limits: QuotaConfig = { ...DEFAULTS, ...(partial || {}) };
  const winMs = windowMs(limits.windowDays);

  return function quotaMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const key = getApiKey(req);
    const plan = planForKey(key);
    const id = key || `ip:${req.ip || "unknown"}`;
    const allowed = allowedFor(plan, limits);

    const t = nowMs();
    let u = usageByKey[id];
    if (!u || t - u.windowStartMs >= winMs) {
      u = usageByKey[id] = { windowStartMs: t, used: 0 };
    }

    if (u.used >= allowed) {
      const retryAfterMs = u.windowStartMs + winMs - t;
      res.status(429).json({
        ok: false,
        error: "DAILY_QUOTA",
        plan,
        allowed,
        used: u.used,
        retryAfterMs,
        resetsAt: new Date(t + retryAfterMs).toISOString(),
      });
      return;
    }

    // consume
    u.used++;

    // response hints
    res.setHeader("x-plan", plan);
    res.setHeader("x-quota-allowed", String(allowed));
    res.setHeader("x-quota-used", String(u.used));
    res.setHeader("x-quota-reset", String(u.windowStartMs + winMs));

    // expose a couple of bits to downstream handlers if they want them
    // (typed as any to avoid pulling in express-serve-static-core types)
    (res as any).locals = (res as any).locals || {};
    (res as any).locals.plan = plan;
    (res as any).locals.quota = { allowed, used: u.used };

    next();
  };
}

// ---- tiny admin helpers (used by /_admin endpoints in index.ts) ------------

export function setPlanForApiKey(apiKey: string, plan: Plan) {
  if (!apiKey) return;
  planByApiKey[apiKey] = plan;
}

export function resetQuota(apiKey?: string) {
  if (!apiKey) {
    for (const k in usageByKey) delete usageByKey[k];
    return;
  }
  delete usageByKey[apiKey];
}

export function snapshotQuota(apiKey?: string) {
  if (!apiKey) return { ...usageByKey };
  return usageByKey[apiKey] ? { ...usageByKey[apiKey] } : null;
}