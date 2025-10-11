// src/middleware/with-plan.ts
//
// Attaches the user's plan to every request.
// - Finds user email from header/query (x-user-email or ?email=…)
// - Resolves plan (Free / Pro / VIP) via shared/plan (if present)
// - Allows admin-only override via x-user-plan + x-admin-key
// - Caches lookups in-memory for ~60s to keep it fast

import type { Request, Response, NextFunction } from "express";

// We import whatever shared/plan exports, but keep graceful fallbacks.
import * as Plan from "../shared/plan";

// Minimal shape we rely on
export type Tier = "free" | "pro" | "vip";
export type PlanInfo = {
  tier: Tier;
  dailyLimit: number;   // e.g., 3 / 25 / 100
  canHide: boolean;     // VIP feature: “Own + Hide”
};

// Augment Express.Request
declare module "express-serve-static-core" {
  interface Request {
    userEmail?: string;
    plan?: PlanInfo;
  }
}

// tiny TTL cache (email -> {plan, until})
const CACHE = new Map<string, { plan: PlanInfo; until: number }>();
const TTL_MS = 60_000;

function now() { return Date.now(); }
function valid(rec?: { until: number }) { return !!rec && rec.until > now(); }

function fallbackPlan(email?: string): PlanInfo {
  // Defaults if shared/plan is missing (or before DB is ready)
  const envPro = Number(process.env.PRO_DAILY || 25);
  const envFree = Number(process.env.FREE_DAILY || 3);
  const envVip  = 100;

  // If you pass ?plan=vip during early dev and ALLOW_TEST=1, we let it through.
  const allowTest = String(process.env.ALLOW_TEST || "0") === "1";
  const hinted = (email || "").toLowerCase().includes("+vip@") ? "vip"
               : (email || "").toLowerCase().includes("+pro@") ? "pro"
               : "free";

  const tier: Tier = allowTest ? (hinted as Tier) : "free";
  if (tier === "vip") return { tier, dailyLimit: envVip,  canHide: true  };
  if (tier === "pro") return { tier, dailyLimit: envPro,  canHide: false };
  return                    { tier:"free", dailyLimit: envFree, canHide: false };
}

async function resolvePlan(email?: string): Promise<PlanInfo> {
  if (!email) return fallbackPlan();

  const cached = CACHE.get(email);
  if (valid(cached)) return cached!.plan;

  let out: PlanInfo | null = null;

  try {
    // Preferred: shared/plan.getPlanForEmail(email) -> PlanInfo
    const fn = (Plan as any)?.getPlanForEmail;
    if (typeof fn === "function") out = await fn(email);
  } catch { /* ignore and fall back */ }

  if (!out) out = fallbackPlan(email);

  CACHE.set(email, { plan: out, until: now() + TTL_MS });
  return out;
}

function adminOverride(req: Request): Tier | null {
  const forced = (req.header("x-user-plan") || "").toLowerCase();
  if (!forced) return null;

  const provided = req.header("x-admin-key") || req.header("x-admin-token") || "";
  const expected = process.env.ADMIN_API_KEY || process.env.ADMIN_TOKEN || "";
  if (!expected || provided !== expected) return null;

  if (forced === "free" || forced === "pro" || forced === "vip") return forced as Tier;
  return null;
}

/**
 * Middleware
 * - Sets req.userEmail (string)
 * - Sets req.plan (PlanInfo)
 * - Exposes x-plan-tier header for easy debugging
 */
export default function withPlan() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 1) find email (header first, then query ?email=)
    const email = String(
      req.header("x-user-email") ||
      req.query.email ||
      ""
    ).trim().toLowerCase() || undefined;

    req.userEmail = email;

    // 2) admin-only override
    const forcedTier = adminOverride(req);
    if (forcedTier) {
      const limits = {
        free: Number(process.env.FREE_DAILY || 3),
        pro:  Number(process.env.PRO_DAILY  || 25),
        vip:  100
      };
      req.plan = {
        tier: forcedTier,
        dailyLimit: limits[forcedTier],
        canHide: forcedTier === "vip",
      };
      res.setHeader("x-plan-tier", req.plan.tier);
      return next();
    }

    // 3) normal resolution
    try {
      req.plan = await resolvePlan(email);
      res.setHeader("x-plan-tier", req.plan.tier);
      return next();
    } catch (e: any) {
      // never block requests; just fall back to Free
      req.plan = fallbackPlan(email);
      res.setHeader("x-plan-tier", req.plan.tier);
      return next();
    }
  };
}