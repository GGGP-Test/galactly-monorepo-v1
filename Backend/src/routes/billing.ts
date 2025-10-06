// src/routes/billing.ts
//
// Billing router (no Stripe SDK).
// - POST  /api/v1/billing/create-checkout-session  -> { url }
// - POST  /api/v1/billing/webhook  (dev: unverified)  -> updates in-memory entitlements
// - GET   /api/v1/billing/entitlements?email=...     -> { plan, sinceIso }
//
// Notes
// - Uses built-in fetch (Node 18+).
// - No signature verification yet (needs express.raw order). Safe enough for dev.
// - Persists a tiny entitlements JSON under /data if possible (best-effort).

import { Router, Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

const r = Router();

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || "").trim();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://gggp-test.github.io/galactly-monorepo-v1").replace(/\/+$/,"");

// ---------------------------- tiny entitlement store ----------------------------

type Plan = "free" | "pro";
type Ent = { plan: Plan; sinceIso: string };

const ENT_PATH = process.env.ENTITLEMENTS_PATH || path.join(process.cwd(), "data", "entitlements.json");
const ents = new Map<string, Ent>(); // key = lowercased email

function emailKey(e?: string){ return String(e||"").trim().toLowerCase(); }

function setEnt(email: string, plan: Plan){
  const k = emailKey(email);
  if (!k) return;
  ents.set(k, { plan, sinceIso: new Date().toISOString() });
  persistEnts().catch(()=>{});
}

function getEnt(email?: string): Ent | undefined {
  const k = emailKey(email);
  return k ? ents.get(k) : undefined;
}

async function persistEnts(){
  try{
    const dir = path.dirname(ENT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
    const obj: Record<string, Ent> = {};
    for (const [k,v] of ents.entries()) obj[k] = v;
    await fsp.writeFile(ENT_PATH, JSON.stringify(obj, null, 2), "utf8");
  }catch{}
}

(function loadEnts(){
  try{
    const txt = fs.existsSync(ENT_PATH) ? fs.readFileSync(ENT_PATH, "utf8") : "";
    if (txt) {
      const obj = JSON.parse(txt) as Record<string, Ent>;
      for (const [k,v] of Object.entries(obj||{})) ents.set(k, v);
    }
  }catch{}
})();

// ---------------------------- helpers ----------------------------

function requireStripe(res: Response): boolean {
  if (!STRIPE_SECRET_KEY) {
    res.status(503).json({ ok:false, error:"stripe_not_configured" });
    return false;
  }
  return true;
}

async function stripeCreateCheckoutSession(input: {
  priceId: string;
  mode: "subscription"|"payment";
  customerEmail?: string;
}): Promise<{ url?: string; id?: string; error?: string }> {
  const params = new URLSearchParams();
  params.set("mode", input.mode);
  params.set("success_url", `${SITE_ORIGIN}/billing-success.html`);
  params.set("cancel_url", `${SITE_ORIGIN}/billing-canceled.html`);
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("allow_promotion_codes", "true");
  if (input.customerEmail) params.set("customer_email", input.customerEmail);

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(()=> "");
    return { error: `stripe_error_${resp.status}: ${t.slice(0,200)}` };
  }
  const data = await resp.json();
  return { url: data.url, id: data.id };
}

// ---------------------------- routes ----------------------------

// POST /api/v1/billing/create-checkout-session  -> { url }
r.post("/create-checkout-session", async (req: Request, res: Response) => {
  if (!requireStripe(res)) return;

  try{
    const priceId = String(req.body?.priceId || "").trim();
    const mode = (req.body?.mode === "payment" ? "payment" : "subscription") as "subscription"|"payment";
    const customerEmail = String(req.body?.customerEmail || "").trim() || undefined;

    if (!priceId) return res.status(400).json({ ok:false, error:"priceId_required" });

    const out = await stripeCreateCheckoutSession({ priceId, mode, customerEmail });
    if (out.error || !out.url) return res.status(200).json({ ok:false, error: out.error || "unknown" });
    return res.json({ ok:true, url: out.url });
  }catch(e:any){
    res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
});

// POST /api/v1/billing/webhook
// DEV NOTE: this handler trusts JSON (no signature verification). Good enough for staging.
// If you later want verification, we’ll switch this route to use express.raw() in index.ts.
r.post("/webhook", async (req: Request, res: Response) => {
  try{
    const event = req.body || {};
    const type = String(event?.type || "");

    if (type === "checkout.session.completed") {
      const email = event?.data?.object?.customer_details?.email || event?.data?.object?.customer_email;
      if (email) setEnt(email, "pro");
    }

    if (type === "customer.subscription.deleted" || type === "charge.refunded") {
      // best-effort fallback: Stripe sometimes includes customer_email in related objects
      const email =
        event?.data?.object?.customer_email ||
        event?.data?.object?.customer_details?.email ||
        "";
      if (email) setEnt(email, "free");
    }

    res.json({ received: true });
  }catch(e:any){
    res.status(200).json({ ok:false, error:String(e?.message||e) });
  }
});

// GET /api/v1/billing/entitlements?email=...
r.get("/entitlements", (req: Request, res: Response) => {
  const email = String(req.query.email || "").trim();
  const ent = getEnt(email) || { plan:"free", sinceIso:null };
  res.json({ ok:true, email, ...ent });
});

export default r;