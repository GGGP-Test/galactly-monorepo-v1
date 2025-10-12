// src/routes/stripe-webhook.ts
//
// Stripe webhook router (no stripe npm dep).
// - GET  /api/stripe/webhook           -> "stripe-webhook-ok"
// - POST /api/stripe/webhook           -> verify + persist to Neon (stripe_subs)
//
// IMPORTANT: index.ts MUST mount this BEFORE express.json:
//   app.use("/api/stripe/webhook", StripeWebhook);

import express, { Request, Response } from "express";
import crypto from "crypto";
import { pool } from "../shared/db"; // Neon/PG pool

const router = express.Router();

/* ------------------------------ health ----------------------------------- */

router.get("/", (_req, res) => res.type("text/plain").send("stripe-webhook-ok"));
router.get("/_ping", (_req, res) => res.json({ ok: true, route: "stripe-webhook" }));

/* ----------------------------- DB helpers -------------------------------- */

async function ensureTable() {
  await pool.query(`
    create table if not exists stripe_subs (
      email           text primary key,
      subscription_id text,
      customer_id     text,
      price_id        text,
      status          text,
      updated_at      timestamptz not null default now()
    );
    create index if not exists stripe_subs_updated_idx on stripe_subs(updated_at desc);
  `);
}

type SubRow = {
  email: string;
  subscription_id?: string | null;
  customer_id?: string | null;
  price_id?: string | null;
  status?: string | null;
};

function cleanEmail(v: any): string {
  const e = String(v || "").trim().toLowerCase();
  return e.includes("@") ? e : "";
}

async function upsertSub(row: SubRow) {
  // ignore if no email
  if (!row.email) return;
  await ensureTable();
  await pool.query(
    `
    insert into stripe_subs(email, subscription_id, customer_id, price_id, status, updated_at)
    values ($1, $2, $3, $4, $5, now())
    on conflict (email) do update
      set subscription_id = coalesce(excluded.subscription_id, stripe_subs.subscription_id),
          customer_id     = coalesce(excluded.customer_id,     stripe_subs.customer_id),
          price_id        = coalesce(excluded.price_id,        stripe_subs.price_id),
          status          = coalesce(excluded.status,          stripe_subs.status),
          updated_at      = now()
  `,
    [
      row.email,
      row.subscription_id ?? null,
      row.customer_id ?? null,
      row.price_id ?? null,
      row.status ?? null,
    ]
  );
}

/* ---------------------- signature verification --------------------------- */

function parseStripeSig(headerRaw: string | string[] | undefined): { t: string; v1: string } {
  const header = Array.isArray(headerRaw) ? headerRaw.join(",") : String(headerRaw || "");
  const parts = header.split(",").map((p) => p.trim());
  let t = "", v1 = "";
  for (const p of parts) {
    const [k, v] = p.split("=", 2);
    if (k === "t") t = v || "";
    if (k === "v1") v1 = v || "";
  }
  return { t, v1 };
}

function timingSafeEq(a: string, b: string): boolean {
  const A = Buffer.from(a, "utf8");
  const B = Buffer.from(b, "utf8");
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function verifyOrThrow(raw: Buffer, sigHeader: string | string[] | undefined, secret: string, tolSec = 300) {
  if (!secret) throw new Error("webhook secret missing");
  const { t, v1 } = parseStripeSig(sigHeader);
  if (!t || !v1) throw new Error("bad signature header");
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  if (!timingSafeEq(expected, v1)) throw new Error("signature mismatch");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > tolSec) throw new Error("timestamp outside tolerance");
}

/* ------------------------- event normalization --------------------------- */
/**
 * Try to extract (email, subscription_id, customer_id, price_id, status)
 * from common Stripe event payloads.
 */
function extractRowFromEvent(event: any): SubRow | null {
  const type = String(event?.type || "");
  const obj  = event?.data?.object || {};

  // email sources common across event types
  const email =
    cleanEmail(
      obj?.customer_details?.email ||
      obj?.customer_email ||
      obj?.receipt_email ||
      obj?.billing_details?.email ||
      obj?.metadata?.email
    ) ||
    cleanEmail(event?.data?.object?.customer_email);

  // baseline fields
  let subscription_id: string | undefined =
    obj?.subscription || obj?.id; // for customer.subscription.* obj.id is the sub id
  let customer_id: string | undefined = obj?.customer || obj?.customer_id;

  // price id hunting across event types
  let price_id: string | undefined;

  // 1) customer.subscription.*
  if (type.startsWith("customer.subscription.")) {
    subscription_id = obj?.id;
    customer_id = obj?.customer;
    price_id = obj?.items?.data?.[0]?.price?.id;
  }

  // 2) invoice.payment_* (often carries lines -> price)
  if (type.startsWith("invoice.")) {
    customer_id = obj?.customer;
    // top-level email fallback
    // price from first line (if present)
    price_id = obj?.lines?.data?.[0]?.price?.id || price_id;
    // map back to sub if present on invoice
    subscription_id = obj?.subscription || subscription_id;
  }

  // 3) checkout.session.completed (subscription id is on object)
  if (type === "checkout.session.completed") {
    subscription_id = obj?.subscription || subscription_id;
    customer_id = obj?.customer || customer_id;
    // price may be absent unless you expand in the Checkout session;
    // we'll learn it later from invoice/subscription events if missing.
  }

  // status:
  const status =
    obj?.status || // subscription status if customer.subscription.*
    (type.startsWith("invoice.") ? (obj?.paid ? "active" : "past_due") : undefined) ||
    undefined;

  const row: SubRow = {
    email,
    subscription_id: subscription_id || null,
    customer_id: customer_id || null,
    price_id: price_id || null,
    status: status || null,
  };

  // we MUST have at least an email to index by
  if (!row.email) return null;
  return row;
}

/* ------------------------------- webhook ---------------------------------- */

router.post(
  "/",
  // must be raw for signature verification
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    try {
      const secret =
        process.env.STRIPE_WEBHOOK_SECRET ||
        (process as any).env?.STRIPE_WEBHOOK_SECRET ||
        "";
      verifyOrThrow(req.body as Buffer, req.header("stripe-signature"), secret);

      const event = JSON.parse((req.body as Buffer).toString("utf8"));
      const type = String(event?.type || "");
      const row = extractRowFromEvent(event);

      // persist best-effort; ignore if we couldn't find an email
      if (row) {
        await upsertSub(row);
      }

      console.log("[stripe:webhook]", type, row || "(no row)");
      return res.status(200).json({ ok: true, type, persisted: !!row });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[stripe:webhook][error]", msg);
      return res.status(400).json({ ok: false, error: "bad-request", detail: msg });
    }
  }
);

export default router;