// src/routes/billing.ts
//
// Stripe checkout + webhook + simple plan store (v1).
// Mount in index.ts:  app.use("/api/v1/billing", BillingRouter)
//
// Env needed:
//   STRIPE_SECRET_KEY=sk_live_or_test_...
//   STRIPE_WEBHOOK_SECRET=whsec_...          (from Stripe Dashboard -> Webhooks)
//   SITE_ORIGIN=https://YOUR_SITE/           (where to send users after checkout)
//   PLAN_STORE_FILE=./data/plans.json        (optional; defaults to ./data/plans.json)

import express, { Router, Request, Response } from "express";
import Stripe from "stripe";
import fs from "fs";
import path from "path";

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || "https://gggp-test.github.io/galactly-monorepo-v1/").replace(/\/+$/,"") + "/";
const STORE_FILE = path.resolve(process.env.PLAN_STORE_FILE || "./data/plans.json");

// ---------------- plan store (simple v1) ----------------
type PlanTier = "free" | "pro";
type PlanRec = { plan: PlanTier; customerId?: string; updatedAt: string };

const PLAN = new Map<string /*email*/, PlanRec>();

function ensureDir(p: string){ try{ fs.mkdirSync(path.dirname(p), { recursive:true }); }catch{} }
function loadStore(){
  try{
    const txt = fs.readFileSync(STORE_FILE, "utf8");
    const obj = JSON.parse(txt) as Record<string, PlanRec>;
    Object.entries(obj).forEach(([email, rec]) => PLAN.set(email, rec));
  }catch{/* first run okay */}
}
function saveStore(){
  try{
    ensureDir(STORE_FILE);
    const obj: Record<string, PlanRec> = {};
    for (const [k,v] of PLAN.entries()) obj[k] = v;
    fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), "utf8");
  }catch{/* ignore disk write errors on ephemeral envs */}
}
loadStore();

// ---------------- router ----------------
export const BillingRouter = Router();

// create-checkout-session
BillingRouter.post("/create-checkout-session", async (req: Request, res: Response) => {
  try{
    if (!STRIPE_SECRET_KEY) return res.status(503).json({ ok:false, error:"Stripe not configured" });
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any });

    const { priceId, mode = "subscription", customerEmail } = req.body || {};
    if (!priceId) return res.status(400).json({ ok:false, error:"priceId required" });

    const session = await stripe.checkout.sessions.create({
      mode: mode as "subscription"|"payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${SITE_ORIGIN}billing-success.html`,
      cancel_url:  `${SITE_ORIGIN}billing-canceled.html`,
      customer_email: customerEmail || undefined,
      allow_promotion_codes: true
    });

    res.json({ ok:true, url: session.url });
  }catch(e:any){
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

// webhook (use raw body to verify signature)
const rawParser = express.raw({ type: "application/json" });
BillingRouter.post("/webhook", rawParser, async (req: Request, res: Response) => {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return res.status(503).send("Stripe not configured");
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" as any });

  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;
  try{
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  }catch(err:any){
    return res.status(400).send(`Webhook Error: ${err.message || err}`);
  }

  try{
    switch(event.type){
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const email = (s.customer_details?.email || s.customer_email || "").toLowerCase();
        const customerId = typeof s.customer === "string" ? s.customer : undefined;
        if (email){
          PLAN.set(email, { plan:"pro", customerId, updatedAt:new Date().toISOString() });
          saveStore();
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        // Best-effort: look up email from latest invoice
        try{
          const invId = sub.latest_invoice as string | undefined;
          if (invId) {
            const inv = await stripe.invoices.retrieve(invId);
            const email = (inv.customer_email || inv.customer_address?.email || "").toLowerCase();
            if (email){
              PLAN.set(email, { plan:"pro", customerId, updatedAt:new Date().toISOString() });
              saveStore();
            }
          }
        }catch{}
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.canceled": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        // Demote any email mapped to this customer
        for (const [email, rec] of PLAN.entries()){
          if (rec.customerId === customerId){
            PLAN.set(email, { plan:"free", customerId, updatedAt:new Date().toISOString() });
          }
        }
        saveStore();
        break;
      }
      default:
        // ignore others
        break;
    }
    res.json({ received:true });
  }catch(e:any){
    res.status(500).send(String(e?.message||e));
  }
});

// plan lookup: /api/v1/billing/plan?email=foo@bar.com
BillingRouter.get("/plan", (req: Request, res: Response) => {
  const email = String(req.query.email || "").toLowerCase().trim();
  if (!email) return res.status(400).json({ ok:false, error:"email required" });
  const rec = PLAN.get(email) || { plan:"free", updatedAt:"" };
  res.json({ ok:true, email, ...rec });
});

// (optional) admin override for testing
BillingRouter.post("/debug/set-plan", (req: Request, res: Response) => {
  const key = (req.header("x-admin-key") || "").trim();
  if (!key || key !== (process.env.ADMIN_KEY || process.env.ADMIN_TOKEN || "")) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  const email = String(req.body?.email || "").toLowerCase().trim();
  const plan = String(req.body?.plan || "free") as PlanTier;
  if (!email) return res.status(400).json({ ok:false, error:"email required" });
  PLAN.set(email, { plan: plan === "pro" ? "pro" : "free", updatedAt:new Date().toISOString() });
  saveStore();
  res.json({ ok:true, email, plan });
});

export default BillingRouter;