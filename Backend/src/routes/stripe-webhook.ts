// src/routes/stripe-webhook.ts
//
// Stripe webhook (works with Payment Links + Subscriptions).
// - Verifies Stripe signature (no Stripe SDK required)
// - Acks immediately with 200 to stop 404/5xx retries
// - Asynchronously inspects the event (and pulls line items)
// - Updates an in-memory plan table keyed by customer email
//
// Env you MUST set (Test mode first):
//   STRIPE_WEBHOOK_SECRET = whsec_...  (from your Workbench endpoint)
//   STRIPE_SECRET_KEY     = sk_test_... (Test key, not live)
//   STRIPE_PRICE_PRO      = price_...   ($97 Pro monthly)
//   STRIPE_PRICE_VIP      = price_...   ($47 Claim&Hide add-on)
//
// Optional fallbacks (if you already have them set):
//   STRIPE_PRICE_ID (alias for STRIPE_PRICE_PRO)
//   STRIPE_PRICE_AUTOMATION (alias for STRIPE_PRICE_VIP)

import express, { Request, Response } from "express";
import crypto from "crypto";
import type { IncomingHttpHeaders } from "http";

const router = express.Router();

// Mount as raw BEFORE express.json (already done in index.ts)
router.post("/", express.raw({ type: "*/*" }), (req: Request, res: Response) => {
  const whsec = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!whsec) {
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET missing — accepting event (DEV)");
    // Accept without verification (DEV only)
    safeAck(res);
    setImmediate(() => handleEventUnsafe(req.headers, req.body));
    return;
  }

  // 1) verify signature (HMAC SHA256)
  const sigHeader = String((req.headers as IncomingHttpHeaders)["stripe-signature"] || "");
  try {
    verifyStripeSignature(sigHeader, req.body, whsec);
  } catch (e: any) {
    console.warn("[stripe] signature verify FAILED:", e?.message || e);
    return res.status(400).json({ ok: false, error: "bad-signature" });
  }

  // 2) Ack immediately so Stripe stops retrying
  safeAck(res);

  // 3) Process in the background
  setImmediate(() => handleEventUnsafe(req.headers, req.body));
});

// simple GET for health/debug
router.get("/", (_req, res) => res.status(200).send("stripe-webhook-ok"));

export default router;

/* -------------------------- helpers & handlers --------------------------- */

function safeAck(res: Response) {
  try { res.status(200).json({ received: true }); } catch { /* ignore */ }
}

function verifyStripeSignature(sigHeader: string, rawBody: any, whsec: string) {
  // Stripe header looks like: t=1697050360,v1=abcdef...,v0=...
  const parts = Object.fromEntries(
    String(sigHeader || "")
      .split(",")
      .map(kv => kv.split("=", 2) as [string, string])
      .filter(([k, v]) => k && v)
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) throw new Error("missing t/v1");

  const payload = `${t}.${bufferToString(rawBody)}`;
  const mac = crypto.createHmac("sha256", whsec);
  const expected = mac.update(payload).digest("hex");
  // constant-time compare
  const ok =
    expected.length === v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));

  if (!ok) throw new Error("hmac mismatch");

  // optional freshness guard (5 min)
  const ageSec = Math.abs(Date.now() / 1000 - Number(t));
  if (Number.isFinite(ageSec) && ageSec > 60 * 5) {
    // Don’t reject; just warn (Stripe may retry delayed)
    console.warn("[stripe] signature old-ish:", Math.round(ageSec), "sec");
  }
}

function bufferToString(b: any): string {
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  if (typeof b === "string") return b;
  try { return Buffer.from(b as any).toString("utf8"); } catch { return ""; }
}

type AnyObj = Record<string, any>;

const PLAN_TABLE: Map<string, {
  plan: "free" | "pro";
  vip: boolean;
  stripeCustomerId?: string;
  subscriptionId?: string;
  updatedAt: string;
}> = new Map();

function upsertPlan(email: string, patch: Partial<AnyObj>) {
  if (!email) return;
  const now = new Date().toISOString();
  const prev = PLAN_TABLE.get(email) || { plan: "free", vip: false, updatedAt: now } as any;
  const next = { ...prev, ...patch, updatedAt: now };
  PLAN_TABLE.set(email, next);
  console.log("[plan] set", email, next);
}

// You can GET this map via /api/events later if you want; for now it’s in-memory.

async function handleEventUnsafe(headers: IncomingHttpHeaders, rawBody: any) {
  let event: AnyObj = {};
  try { event = JSON.parse(bufferToString(rawBody) || "{}"); }
  catch (e) { console.warn("[stripe] bad json", e); return; }

  const type = String(event.type || "");
  const obj  = (event.data && event.data.object) || {};
  console.log("[stripe] event", type, obj?.id || "");

  try {
    switch (type) {
      case "checkout.session.completed": {
        // Prefer email directly from the session
        const email =
          obj?.customer_details?.email ||
          obj?.customer_email ||
          obj?.customer?.email ||
          obj?.metadata?.user_email ||
          "";

        const { hasPro, hasVip } = await detectLineItems(obj?.id);
        if (email) upsertPlan(email, {
          plan: hasPro ? "pro" : "free",
          vip: hasVip,
          stripeCustomerId: obj?.customer || undefined,
          subscriptionId: obj?.subscription || undefined,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const email = await emailFromCustomer(obj?.customer);
        const { hasPro, hasVip } = await detectSubscriptionItems(obj?.id);
        if (email) upsertPlan(email, {
          plan: hasPro ? "pro" : "free",
          vip: hasVip,
          stripeCustomerId: obj?.customer || undefined,
          subscriptionId: obj?.id || undefined,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const email = await emailFromCustomer(obj?.customer);
        if (email) upsertPlan(email, { plan: "free", vip: false });
        break;
      }

      case "invoice.paid": {
        // Nice for logs; plan already set by session/sub events.
        break;
      }

      case "invoice.payment_failed": {
        const email = await emailFromCustomer(obj?.customer);
        if (email) upsertPlan(email, { plan: "free", vip: false });
        break;
      }

      default:
        // ignore other events
        break;
    }
  } catch (err: any) {
    console.warn("[stripe] handler error", type, err?.message || err);
  }
}

/* ------------------------------- Stripe API --------------------------------
   We avoid installing the Stripe SDK. We call the REST endpoints directly.
   Node 18+ has global fetch; if not, replace with node:https request.
-----------------------------------------------------------------------------*/

function sk(): string {
  return String(process.env.STRIPE_SECRET_KEY || "").trim();
}
function proPriceId(): string {
  return String(process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_ID || "").trim();
}
function vipPriceId(): string {
  return String(process.env.STRIPE_PRICE_VIP || process.env.STRIPE_PRICE_AUTOMATION || "").trim();
}

async function emailFromCustomer(customerId?: string): Promise<string> {
  if (!customerId || !sk()) return "";
  try {
    const r = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: "GET",
      headers: { Authorization: "Bearer " + sk() }
    });
    const j = await r.json() as AnyObj;
    return String(j?.email || "");
  } catch { return ""; }
}

async function detectLineItems(sessionId?: string): Promise<{ hasPro: boolean; hasVip: boolean }> {
  if (!sessionId || !sk()) return { hasPro: false, hasVip: false };
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=100&expand[]=data.price`, {
      method: "GET",
      headers: { Authorization: "Bearer " + sk() }
    });
    const j = await r.json() as AnyObj;
    const ids = (j?.data || []).map((it: AnyObj) => it?.price?.id).filter(Boolean);
    return {
      hasPro: ids.includes(proPriceId()),
      hasVip: ids.includes(vipPriceId())
    };
  } catch (e) {
    console.warn("[stripe] detectLineItems failed", e);
    return { hasPro: false, hasVip: false };
  }
}

async function detectSubscriptionItems(subId?: string): Promise<{ hasPro: boolean; hasVip: boolean }> {
  if (!subId || !sk()) return { hasPro: false, hasVip: false };
  try {
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}?expand[]=items.data.price`, {
      method: "GET",
      headers: { Authorization: "Bearer " + sk() }
    });
    const j = await r.json() as AnyObj;
    const ids = (j?.items?.data || []).map((it: AnyObj) => it?.price?.id).filter(Boolean);
    return {
      hasPro: ids.includes(proPriceId()),
      hasVip: ids.includes(vipPriceId())
    };
  } catch (e) {
    console.warn("[stripe] detectSubscriptionItems failed", e);
    return { hasPro: false, hasVip: false };
  }
}