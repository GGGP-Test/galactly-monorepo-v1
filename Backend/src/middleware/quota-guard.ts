// src/middleware/quota-guard.ts
//
// Per-plan daily limits (Free / Pro / VIP) with a tiny in-memory counter.
// - Uses req.plan from with-plan.ts
// - Window = QUOTA_WINDOW_DAYS (default 1 day), resets at next UTC midnight
// - Default daily caps: FREE_DAILY (3), PRO_DAILY (25), VIP_DAILY (100)
// - Admin bypass if x-admin-key matches ADMIN_API_KEY / ADMIN_TOKEN
// - Exposes headers: x-quota-used, x-quota-remaining, x-quota-reset
//
// BV1 note: in-memory is OK; BV2 will move this to Postgres.

import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "pro" | "vip";

export type QuotaOpts = {
  bucket?: string;      // logical bucket name (e.g., "find", "classify")
  cost?: number;        // cost units to charge per request (default 1)
  byIpIfNoEmail?: boolean; // if no email, fall back to IP (default true)
};

type Rec = { used: number; resetAt: number };
const STORE = new Map<string, Rec>();

const DAY_MS = 24 * 60 * 60 * 1000;

function isAdminBypass(req: Request): boolean {
  const provided = req.header("x-admin-key") || req.header("x-admin-token") || "";
  const expected = process.env.ADMIN_API_KEY || process.env.ADMIN_TOKEN || "";
  return !!expected && provided === expected;
}

function getTierLimit(tier: Tier | undefined): number {
  const free = Number(process.env.FREE_DAILY || 3);
  const pro  = Number(process.env.PRO_DAILY  || 25);
  const vip  = Number(process.env.VIP_DAILY  || 100); // optional env; default 100
  if (tier === "vip")  return vip;
  if (tier === "pro")  return pro;
  return free;
}

function getWindowDays(): number {
  const d = Number(process.env.QUOTA_WINDOW_DAYS || 1);
  return Number.isFinite(d) && d > 0 ? d : 1;
}

function nextUtcReset(days: number): number {
  const now = Date.now();
  const utcNow = new Date(now);
  const base = Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate());
  return base + days * DAY_MS;
}

function clientIp(req: Request): string {
  // Express usually exposes req.ip; keep it simple for BV1
  return (req.ip || req.socket?.remoteAddress || "0.0.0.0");
}

function identity(req: Request, byIpIfNoEmail: boolean): string {
  const email = (req as any).userEmail as string | undefined; // set by with-plan
  if (email) return `email:${email}`;
  return byIpIfNoEmail ? `ip:${clientIp(req)}` : "anon";
}

function keyFor(req: Request, bucket: string, byIpIfNoEmail: boolean): string {
  const id = identity(req, byIpIfNoEmail);
  return `${id}:${bucket}`;
}

function ensureRec(key: string, windowDays: number): Rec {
  const now = Date.now();
  const exists = STORE.get(key);
  if (exists && exists.resetAt > now) return exists;
  const rec: Rec = { used: 0, resetAt: nextUtcReset(windowDays) };
  STORE.set(key, rec);
  return rec;
}

function headers(res: Response, used: number, limit: number, resetAt: number) {
  const remaining = Math.max(0, limit - used);
  res.setHeader("x-quota-used", String(used));
  res.setHeader("x-quota-remaining", String(remaining));
  res.setHeader("x-quota-reset", new Date(resetAt).toISOString());
}

export type QuotaStatus = { used: number; limit: number; remaining: number; resetAt: number; tier: Tier | "unknown" };

/**
 * Read-only snapshot helper — useful for a "/api/quota/status" route later.
 */
export function getQuotaStatus(req: Request, bucket = "find"): QuotaStatus {
  const tier = ((req as any).plan?.tier || "unknown") as Tier | "unknown";
  const limit = getTierLimit((req as any).plan?.tier);
  const rec = STORE.get(keyFor(req, bucket, true)) || { used: 0, resetAt: nextUtcReset(getWindowDays()) };
  return { used: rec.used, limit, remaining: Math.max(0, limit - rec.used), resetAt: rec.resetAt, tier };
}

/**
 * Middleware factory
 * Example:
 *   app.use(withPlan());
 *   app.use(quotaGuard({ bucket: "find", cost: 1 }));
 */
export default function quotaGuard(opts: QuotaOpts = {}) {
  const bucket = opts.bucket || "find";
  const cost   = Number.isFinite(opts.cost as number) ? Number(opts.cost) : 1;
  const byIp   = opts.byIpIfNoEmail !== false; // default true

  return (req: Request, res: Response, next: NextFunction) => {
    // Admin bypass
    if (isAdminBypass(req)) return next();

    const tier   = ((req as any).plan?.tier || "free") as Tier;
    const limit  = getTierLimit(tier);
    const win    = getWindowDays();
    const key    = keyFor(req, bucket, byIp);
    const rec    = ensureRec(key, win);

    // If already incremented by the same guard (edge cases), skip
    const onceKey = `__quota_${bucket}_applied`;
    if ((req as any)[onceKey]) {
      headers(res, rec.used, limit, rec.resetAt);
      return next();
    }

    // Check capacity before reserving
    const willUse = rec.used + cost;
    if (willUse > limit) {
      headers(res, rec.used, limit, rec.resetAt);
      return res.status(429).json({
        ok: false,
        error: "quota-exceeded",
        detail: `Daily limit reached for ${tier}. Try after ${new Date(rec.resetAt).toISOString()}.`,
      });
    }

    // Reserve on successful response only
    (req as any)[onceKey] = true;
    res.on("finish", () => {
      // Count only if not an error (HTTP < 400)
      if (res.statusCode < 400) {
        const cur = ensureRec(key, win);
        cur.used = Math.min(limit, cur.used + cost);
      }
    });

    headers(res, rec.used, limit, rec.resetAt);
    return next();
  };
}