// src/routes/stripe-webhook.ts
//
// Stripe webhook (verified) + Neon persistence (no 'stripe' npm dep).
// Mount EARLY: app.use("/api/stripe/webhook", StripeWebhook)
//
// Persists rows into `stripe_subs` so shared/plan.ts can resolve plans by email.

import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import { pool } from "../shared/db";

const WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_SK      = String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || "").trim();

const StripeWebhook = Router();

// Health pings
StripeWebhook.get("/", (_req, res) => res.type("text/plain").send("stripe-webhook-ok"));
StripeWebhook.get("/_ping", (_req, res) => res.type("text/plain").send("stripe-webhook-mounted"));

// --- helpers ---------------------------------------------------------------

function parseStripeSig(headerRaw: string | string[] | undefined) {
  const header = Array.isArray(headerRaw) ? headerRaw.join(",") : String(headerRaw || "");
  const parts = header.split(",").map((p) => p.trim());
  const out: Record<string, string> = {};
  for (const p of parts) { const [k, v] = p.split("=", 2); if (k && v) out[k] = v; }
  return { t: out["t"] || "", v1: out["v1"] || "" };
}
function timingSafeEq(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8"), B = Buffer.from(b, "utf8");
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function verifyStripeSigOrThrow(raw: Buffer, sigHeader: string | string[] | undefined, secret: string, tolSec = 300) {
  if (!secret) throw new Error("missing_webhook_secret");
  const { t, v1 } = parseStripeSig(sigHeader);
  if (!t || !v1) throw new Error("bad_signature_header");
  const signed = `${t}.${raw.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  if (!timingSafeEq(expected, v1)) throw new Error("signature_mismatch");
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolSec) throw new Error("timestamp_out_of_tolerance");
}

// Quick Stripe REST GET using secret (no SDK)
async function stripeGet(path: string): Promise<any> {
  if (!STRIPE_SK) return null;
  const r = await fetch(`https://api.stripe.com${path}`, { headers: { Authorization: `Bearer ${STRIPE_SK}` } });
  if (!r.ok) return null;
  return r.json();
}

async function findEmailFromCustomer(customerId?: string): Promise<string | null> {
  if (!customerId || !STRIPE_SK) return null;
  const cust = await stripeGet(`/v1/customers/${encodeURIComponent(customerId)}`);
  const email = cust?.email || cust?.metadata?.email || null;
  return email ? String(email).toLowerCase() : null;
}
async function subscriptionDetails(subId?: string): Promise<{ priceId: string | null; status: string | null } | null> {
  if (!subId || !STRIPE_SK) return null;
  const sub = await stripeGet(`/v1/subscriptions/${encodeURIComponent(subId)}?expand[]=items.data.price`);
  const status = sub?.status || null;
  const priceId =
    Array.isArray(sub?.items?.data) && sub.items.data.length ? (sub.items.data[0]?.price?.id || null) : null;
  return { priceId, status };
}

async function ensureTable() {
  await pool.query(`
    create table if not exists stripe_subs (
      email           text not null,
      subscription_id text,
      price_id        text,
      status          text,
      updated_at      timestamptz not null default now(),
      primary key (email, subscription_id)
    );
    create index if not exists stripe_subs_email_updated_idx on stripe_subs(email, updated_at desc);
  `);
}
async function upsertSub(row: { email: string; subscription_id: string | null; price_id: string | null; status: string | null }) {
  await ensureTable();
  await pool.query(
    `
    insert into stripe_subs(email, subscription_id, price_id, status, updated_at)
    values ($1, $2, $3, $4, now())
    on conflict (email, subscription_id) do update
      set price_id = excluded.price_id,
          status   = excluded.status,
          updated_at = now()
    `,
    [row.email.toLowerCase(), row.subscription_id, row.price_id, row.status]
  );
}

// --- webhook (must use raw body) -------------------------------------------

StripeWebhook.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      verifyStripeSigOrThrow(req.body as Buffer, req.header("stripe-signature"), WEBHOOK_SECRET);

      const evt = JSON.parse((req.body as Buffer).toString("utf8"));
      const type: string = String(evt?.type || "");
      const obj: any = evt?.data?.object || {};

      let email: string | null = null;
      let subId: string | null = null;
      let priceId: string | null = null;
      let status: string | null = null;

      if (type === "checkout.session.completed") {
        subId = obj?.subscription || null;
        email = (obj?.customer_details?.email || obj?.customer_email || null);
        if (!email) email = await findEmailFromCustomer(obj?.customer || null);
        if (subId) {
          const det = await subscriptionDetails(subId);
          priceId = det?.priceId || null;
          status  = det?.status  || null;
        }
      }

      if (type.startsWith("customer.subscription.")) {
        subId = obj?.id || null;
        status = obj?.status || null;
        priceId =
          Array.isArray(obj?.items?.data) && obj.items.data.length ? (obj.items.data[0]?.price?.id || null) : null;
        email = (obj?.metadata?.email || null) || (await findEmailFromCustomer(obj?.customer || null));
      }

      if (email) {
        await upsertSub({ email, subscription_id: subId, price_id: priceId, status });
      }

      // Always 200 so Stripe doesn't retry on transient parsing branches
      return res.json({ received: true, type, email: email || null, subscription_id: subId || null });
    } catch (err: any) {
      console.error("[stripe:webhook] error:", err?.message || err);
      // Still return 200; Stripe will retry only on non-2xx and we verified signature already.
      return res.status(200).json({ ok: false, error: "webhook-failed", detail: String(err?.message || err) });
    }
  }
);

export default StripeWebhook;