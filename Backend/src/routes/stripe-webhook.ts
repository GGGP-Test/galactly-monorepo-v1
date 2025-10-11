// src/routes/stripe-webhook.ts
//
// Express router for Stripe webhooks (no external deps).
// - GET  /api/stripe/webhook           -> "stripe-webhook-ok" (health check)
// - POST /api/stripe/webhook           -> verifies Stripe-Signature, logs, 200
//
// IMPORTANT: in src/index.ts you must mount this BEFORE express.json:
//   import StripeWebhook from "./routes/stripe-webhook";
//   app.use("/api/stripe/webhook", StripeWebhook);

import express, { Request, Response } from "express";
import crypto from "crypto";

const router = express.Router();

// Health ping so you can open it in a browser
router.get("/", (_req: Request, res: Response) => {
  res.type("text/plain").send("stripe-webhook-ok");
});

// --- helpers ---------------------------------------------------------------

function parseStripeSignature(
  headerRaw: string | string[] | undefined
): { t: string; v1: string } {
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

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyStripeSigOrThrow(
  rawBody: Buffer,
  sigHeader: string | string[] | undefined,
  secret: string,
  toleranceSec = 300
): void {
  if (!secret) throw new Error("webhook secret missing");
  const { t, v1 } = parseStripeSignature(sigHeader);
  if (!t || !v1) throw new Error("bad signature header");

  const signedPayload = `${t}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  if (!safeEqual(expected, v1)) throw new Error("signature mismatch");

  const nowSec = Math.floor(Date.now() / 1000);
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) {
    throw new Error("timestamp outside tolerance");
  }
}

// --- webhook (must use raw body) -------------------------------------------

router.post(
  "/",
  // Stripe sends application/json; we need the raw bytes for signature verification
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    try {
      const secret =
        process.env.STRIPE_WEBHOOK_SECRET ||
        (process as any).env?.STRIPE_WEBHOOK_SECRET ||
        "";

      verifyStripeSigOrThrow(req.body as Buffer, req.header("stripe-signature"), secret);

      // Parse the event after verifying the signature
      let event: any = {};
      try {
        event = JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        throw new Error("invalid JSON");
      }

      // Minimal handler — we just log; plan updates wire in later
      const type = String(event.type || "");
      const id = String(event.id || "");
      const data = event.data?.object || {};

      // Common details for debugging
      const customer = data.customer || data.customer_id || null;
      const email =
        data.customer_details?.email ||
        data.customer_email ||
        data.receipt_email ||
        null;

      console.log("[stripe:webhook]", { id, type, customer, email });

      // Return 200 immediately (idempotent; Stripe retries on non-2xx)
      return res.status(200).json({ ok: true, id, type });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[stripe:webhook][error]", msg);
      return res.status(400).json({ ok: false, error: "bad-request", detail: msg });
    }
  }
);

export default router;