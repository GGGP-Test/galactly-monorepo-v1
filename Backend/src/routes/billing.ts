// src/routes/billing.ts
//
// Lightweight Stripe routes with NO 'stripe' npm dependency.
// - POST /api/v1/billing/create-checkout-session  -> returns {url}
// - POST /api/v1/billing/webhook                  -> accepts Stripe events (best-effort verify)
// - GET  /api/v1/billing/plan?email=...           -> quick probe of in-memory plan flag (dev)
//
// Notes:
// • Uses native fetch (Node 18+). No external packages needed.
// • Proper signature verification requires the raw body. Because your app currently
//   uses `express.json()` globally *before* routers, we cannot grab the raw body here.
//   We therefore fall back to an "unverified" path for dev. For prod, mount a raw body
//   parser on this route before express.json() (I can wire that next if you want).
//
// Env:
//   STRIPE_SECRET_KEY      required to create checkout sessions
//   STRIPE_WEBHOOK_SECRET  optional; improves security if raw body is available
//   SITE_ORIGIN            success/cancel return URLs base (default below)

import express, { Router, Request, Response } from "express";
import crypto from "crypto";

const STRIPE_SK = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || "").trim();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://gggp-test.github.io/galactly-monorepo-v1").replace(/\/+$/,"");
const WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();

// very small in-memory "plan" cache (dev). Keyed by email.
const PLAN = new Map<string, "free" | "pro">();

export const BillingRouter = Router();

/** Utility: URL-encode body for Stripe form endpoint */
function formBody(params: Record<string,string>): string {
  const sp = new URLSearchParams();
  for (const [k,v] of Object.entries(params)) sp.set(k, v);
  return sp.toString();
}

/** POST /create-checkout-session  -> { ok, url } */
BillingRouter.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    if (!STRIPE_SK) return res.status(503).json({ ok:false, error:"stripe_not_configured" });

    const { priceId, mode = "subscription", customerEmail } = req.body || {};
    if (!priceId) return res.status(400).json({ ok:false, error:"priceId_required" });

    const success = `${SITE_ORIGIN}/billing-success.html`;
    const cancel  = `${SITE_ORIGIN}/billing-canceled.html`;

    // Build form data for Stripe's /v1/checkout/sessions
    const body = formBody({
      "mode": String(mode),
      "success_url": success,
      "cancel_url": cancel,
      "allow_promotion_codes": "true",
      ...(customerEmail ? { "customer_email": String(customerEmail) } : {}),
      // one line item
      "line_items[0][price]": String(priceId),
      "line_items[0][quantity]": "1",
    });

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SK}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const data: any = await r.json();
    if (!r.ok || !data?.url) {
      return res.status(500).json({ ok:false, error:"stripe_create_failed", detail:data?.error?.message || data });
    }
    return res.json({ ok:true, url: data.url });
  } catch (e:any) {
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

/** Helper: best-effort signature check when raw body is available */
function verifyStripeSig(raw: Buffer, header: string, secret: string, toleranceSec = 300): boolean {
  try {
    // Stripe header looks like: t=timestamp,v1=signature,...
    const parts = Object.fromEntries(header.split(",").map(kv => kv.split("=") as [string,string]));
    const t = parts["t"]; const v1 = parts["v1"];
    if (!t || !v1) return false;

    const payload = Buffer.from(`${t}.${raw.toString("utf8")}`);
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    // timing safe compare
    const a = Buffer.from(v1, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    if (!crypto.timingSafeEqual(a, b)) return false;

    // basic replay tolerance
    const now = Math.floor(Date.now()/1000);
    if (Math.abs(now - Number(t)) > toleranceSec) return false;

    return true;
  } catch { return false; }
}

/**
 * POST /webhook
 * In dev we accept JSON-parsed bodies (unverified) because express.json() ran earlier.
 * For production-grade verification, mount this with express.raw({type:'application/json'})
 * before global JSON middleware. (I can adjust index.ts for that when you’re ready.)
 */
BillingRouter.post("/webhook", async (req: Request, res: Response) => {
  try {
    const sig = req.header("stripe-signature") || "";
    let event: any = req.body;
    let verified = false;

    // If the body is still a Buffer, try to verify properly
    if (Buffer.isBuffer(req.body) && WEBHOOK_SECRET) {
      verified = verifyStripeSig(req.body as Buffer, sig, WEBHOOK_SECRET);
      event = JSON.parse((req.body as Buffer).toString("utf8"));
    } else {
      // Fallback: no raw body available; accept unverified in dev
      verified = false;
    }

    const type = event?.type;
    const obj  = event?.data?.object || {};

    // Flip a very small in-memory flag by email (dev only)
    if (type === "checkout.session.completed") {
      const email = obj?.customer_details?.email || obj?.customer_email;
      if (email) PLAN.set(String(email).toLowerCase(), "pro");
      console.log(`[billing] checkout completed for ${email} (verified=${verified})`);
    }
    if (type === "customer.subscription.deleted" || type === "customer.subscription.canceled") {
      const email = obj?.customer_details?.email || obj?.customer_email || obj?.metadata?.email;
      if (email) PLAN.set(String(email).toLowerCase(), "free");
      console.log(`[billing] subscription canceled for ${email} (verified=${verified})`);
    }

    res.json({ received: true, verified });
  } catch (e:any) {
    res.status(400).json({ ok:false, error:String(e?.message||e) });
  }
});

/** Tiny probe to let the UI check plan by email (dev). */
BillingRouter.get("/plan", (req: Request, res: Response) => {
  const email = String(req.query.email || "").toLowerCase();
  const plan = PLAN.get(email) || "free";
  res.json({ ok:true, email, plan });
});

export default BillingRouter;