// src/routes/plan.ts
//
// Returns the user's plan + caps based on Stripe subscriptions.
// Supports two models:
//  - Pro only: STRIPE_PRICE_PRO
//  - Pro+VIP bundle: STRIPE_PRICE_BUNDLE   (your $144 price)
// Optionally also detects a separate VIP add-on if STRIPE_PRICE_VIP is set.
//
// Input: x-user-email header (or ?email=)
// Output: { plan: "free"|"pro", vip: boolean, dailyLimit: number, remainingToday: number, source: "free"|"stripe" }

import express, { Request, Response } from "express";
import Stripe from "stripe";

const router = express.Router();

// --- env helpers ------------------------------------------------------------

function getEnv(name: string, dflt = ""): string {
  const v = process.env[name];
  return (v == null || v === "") ? dflt : String(v);
}

const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY", "");
const PRICE_PRO         = getEnv("STRIPE_PRICE_PRO", "");
const PRICE_BUNDLE     = getEnv("STRIPE_PRICE_BUNDLE", ""); // Pro+VIP bundle (your $144)
const PRICE_VIP        = getEnv("STRIPE_PRICE_VIP", "");     // optional separate add-on

const FREE_DAILY = Number(getEnv("FREE_DAILY", "3"));
const PRO_DAILY  = Number(getEnv("PRO_DAILY",  "25"));

// --- stripe init (lazy) -----------------------------------------------------

let stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null;
  if (!stripe) stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
  return stripe;
}

// --- core logic -------------------------------------------------------------

type PlanOut = {
  ok: boolean;
  email: string;
  plan: "free" | "pro";
  vip: boolean;
  dailyLimit: number;
  remainingToday: number;
  source: "free" | "stripe";
  detail?: string;
};

function pickEmail(req: Request): string {
  const h = String(req.header("x-user-email") || "").trim();
  if (h) return h.toLowerCase();
  const q = String(req.query.email || "").trim();
  return q ? q.toLowerCase() : "";
}

function computeCaps(plan: "free"|"pro", vip: boolean): { daily: number } {
  if (plan === "pro") return { daily: PRO_DAILY };
  return { daily: FREE_DAILY };
}

function hasAny(items: string[], ids: Set<string>): boolean {
  for (const id of items) if (ids.has(id)) return true;
  return false;
}

async function detectFromStripe(email: string): Promise<{ plan:"pro"|"free"; vip:boolean; prices:string[] } | null> {
  const s = getStripe();
  if (!s) return null;

  // 1) find customer(s) by email
  const customers = await s.customers.list({ email, limit: 5 });
  if (!customers.data.length) return { plan: "free", vip: false, prices: [] };

  const wantedStatuses: Stripe.Subscription.Status[] = ["active", "trialing"];

  // 2) scan each customer's subscriptions for active/trialing
  const priceIds: string[] = [];
  for (const c of customers.data) {
    const subs = await s.subscriptions.list({
      customer: c.id,
      status: "all",
      expand: ["data.items.data.price.product"],
      limit: 10,
    });
    for (const sub of subs.data) {
      if (!wantedStatuses.includes(sub.status)) continue;
      for (const it of sub.items.data) {
        const pid = it.price?.id || "";
        if (pid) priceIds.push(pid);
      }
    }
  }

  if (!priceIds.length) return { plan: "free", vip: false, prices: [] };

  const set = new Set(priceIds);

  // Model A: Pro+VIP bundle (single price)
  const hasBundle = !!(PRICE_BUNDLE && set.has(PRICE_BUNDLE));

  // Model B: Pro base + VIP add-on (two prices)
  const hasPro = !!(PRICE_PRO && set.has(PRICE_PRO));
  const hasVipAddon = !!(PRICE_VIP && set.has(PRICE_VIP));

  const vip = hasBundle || hasVipAddon;
  const pro = hasBundle || hasPro || vip; // any VIP implies at least Pro privileges

  return { plan: pro ? "pro" : "free", vip, prices: priceIds };
}

// --- route ------------------------------------------------------------------

router.get("/me", async (req: Request, res: Response) => {
  const email = pickEmail(req);
  if (!email) {
    // Anonymous → Free defaults
    const daily = computeCaps("free", false).daily;
    const out: PlanOut = { ok: true, email: "", plan: "free", vip: false, dailyLimit: daily, remainingToday: daily, source: "free" };
    return res.json(out);
  }

  try {
    const found = await detectFromStripe(email);
    if (!found) {
      // Stripe not configured → treat as Free
      const daily = computeCaps("free", false).daily;
      const out: PlanOut = { ok: true, email, plan: "free", vip: false, dailyLimit: daily, remainingToday: daily, source: "free", detail: "stripe-not-configured" };
      return res.json(out);
    }

    const daily = computeCaps(found.plan, found.vip).daily;

    // Quotas not wired yet: until quota-store lands, remainingToday = dailyLimit
    const out: PlanOut = {
      ok: true,
      email,
      plan: found.plan,
      vip: found.vip,
      dailyLimit: daily,
      remainingToday: daily,
      source: "stripe",
    };
    return res.json(out);
  } catch (err: any) {
    const msg = err?.message || String(err);
    const daily = computeCaps("free", false).daily;
    const out: PlanOut = { ok: true, email, plan: "free", vip: false, dailyLimit: daily, remainingToday: daily, source: "free", detail: `fallback:${msg}` };
    return res.json(out);
  }
});

export default router;