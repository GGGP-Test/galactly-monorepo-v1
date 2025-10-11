// src/shared/plan.ts
//
// Single source of truth for a user's plan and daily limits.
// - Maps Stripe price IDs -> plan names
// - Looks up latest active sub by email (DB if available; safe fallbacks)
// - Caches answers briefly to avoid DB spam
//
// Usage:
//   const { plan, email } = await planForReq(req);
//   const limit = dailyLimit(plan); // numbers used by quota/claim routes
//
// Notes:
// - Pro price: process.env.STRIPE_PRICE_PRO       -> "pro"
// - Bundle (Pro+VIP): process.env.STRIPE_PRICE_BUNDLE -> "vip"
// - Header overrides only honored when ALLOW_TEST=1 (for local/dev)

import type { Request } from "express";

export type Plan = "free" | "pro" | "vip";

const PRICE_PRO     = String(process.env.STRIPE_PRICE_PRO || "").trim();
const PRICE_BUNDLE  = String(process.env.STRIPE_PRICE_BUNDLE || "").trim();
const ALLOW_TEST    = String(process.env.ALLOW_TEST || "0") === "1";

// Daily allowances (centralized)
export function dailyLimit(plan: Plan): number {
  if (plan === "vip") return 100;
  if (plan === "pro") return 25;
  return 3;
}

// ---- priceId -> plan -------------------------------------------------------
export function planFromPriceId(priceId?: string): Plan {
  const id = String(priceId || "").trim();
  if (!id) return "free";
  if (PRICE_BUNDLE && id === PRICE_BUNDLE) return "vip";
  if (PRICE_PRO     && id === PRICE_PRO)     return "pro";
  // Unknown price: treat as Pro baseline unless you prefer "free"
  return "pro";
}

// ---- tiny cache ------------------------------------------------------------
type CacheVal = { plan: Plan; at: number };
const CACHE = new Map<string, CacheVal>();
const CACHE_MS = 5 * 60 * 1000; // 5 minutes

function getCached(email: string): Plan | null {
  const row = CACHE.get(email);
  if (!row) return null;
  if (Date.now() - row.at > CACHE_MS) { CACHE.delete(email); return null; }
  return row.plan;
}
function setCached(email: string, plan: Plan) {
  if (!email) return;
  CACHE.set(email, { plan, at: Date.now() });
}

// ---- database lookup (best-effort; no hard dependency) ---------------------
async function lookupPlanInDb(email: string): Promise<Plan | null> {
  if (!email) return null;

  // Try pg if present
  let pg: any = null;
  try { pg = require("pg"); } catch { /* not installed -> fallback */ }
  const url = process.env.DATABASE_URL || "";
  if (!pg || !url) return null;

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    // 1) If your webhook stores plan directly:
    //    subscriptions(email, plan, status, updated_at)
    const q1 = `
      SELECT plan, price_id
      FROM subscriptions
      WHERE email = $1
        AND status IN ('active','trialing')
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const r1 = await client.query(q1, [email]);
    if (r1.rows && r1.rows.length) {
      const row = r1.rows[0] || {};
      if (row.plan)   return (String(row.plan) as Plan) || "pro";
      if (row.price_id) return planFromPriceId(String(row.price_id));
    }

    // 2) Alternate schema: stripe_subs(email, price_id, status, updated_at)
    const q2 = `
      SELECT price_id
      FROM stripe_subs
      WHERE email = $1
        AND status IN ('active','trialing')
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const r2 = await client.query(q2, [email]);
    if (r2.rows && r2.rows.length) {
      const priceId = String(r2.rows[0]?.price_id || "");
      if (priceId) return planFromPriceId(priceId);
    }

    // 3) Nothing found
    return null;
  } catch {
    return null; // fail soft
  } finally {
    try { await client.end(); } catch {}
  }
}

// ---- request helpers -------------------------------------------------------
function normEmail(input: any): string {
  const e = String(input || "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

/**
 * Plan resolution order:
 * 1) If ALLOW_TEST=1 and header has x-user-plan=free|pro|vip -> use it (dev only)
 * 2) Cache (if we looked it up recently)
 * 3) DB lookup by email (active/trialing sub)
 * 4) Default "free"
 */
export async function planForEmail(email: string, headerPlan?: string): Promise<Plan> {
  const hPlan = String(headerPlan || "").toLowerCase();
  if (ALLOW_TEST && (hPlan === "free" || hPlan === "pro" || hPlan === "vip")) {
    return hPlan as Plan;
  }
  if (email) {
    const cached = getCached(email);
    if (cached) return cached;
  }
  const dbPlan = email ? await lookupPlanInDb(email) : null;
  const plan: Plan = dbPlan || "free";
  setCached(email, plan);
  return plan;
}

/**
 * Extracts (email, plan) from the request in a consistent way.
 * - Email: from header x-user-email (your FE sets this); else empty
 * - Plan: resolved via planForEmail
 */
export async function planForReq(req: Request): Promise<{ email: string; plan: Plan }> {
  const email = normEmail(req.headers["x-user-email"]);
  const headerPlan = String(req.headers["x-user-plan"] || "");
  const plan = await planForEmail(email, headerPlan);
  return { email, plan };
}

// Convenience flags
export const isPro = (p: Plan) => p === "pro" || p === "vip";
export const isVip = (p: Plan) => p === "vip";