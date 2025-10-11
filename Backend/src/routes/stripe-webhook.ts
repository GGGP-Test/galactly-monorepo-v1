// src/routes/stripe-webhook.ts
// Minimal Stripe webhook (no Stripe SDK). Verifies signature with HMAC.
// Requires env: STRIPE_WEBHOOK_SECRET (the *Test* or *Live* signing secret).

import express, { Request, Response } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { CFG } from "../shared/env";

const router = express.Router();

// simple GET so a browser shows the route is mounted
router.get("/", (_req, res) => res.type("text/plain").send("stripe-webhook-ok"));

// IMPORTANT: raw body for signature verification
const rawParser = express.raw({ type: "application/json" });

function verifyStripeSig(rawBody: Buffer, sigHeader: string | undefined, secret: string): boolean {
  if (!sigHeader) return false;

  // header looks like: t=1697050000,v1=<hex>,v0=...
  let ts = "", v1 = "";
  for (const part of sigHeader.split(",").map(s => s.trim())) {
    if (part.startsWith("t=")) ts = part.slice(2);
    if (part.startsWith("v1=")) v1 = part.slice(3);
  }
  if (!ts || !v1) return false;

  const signed = `${ts}.${rawBody.toString("utf8")}`;
  const mac = crypto.createHmac("sha256", secret).update(signed).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(v1));
  } catch {
    return false;
  }
}

function logEvent(name: string, payload: any) {
  try {
    const fp = path.join("/mnt/data", `stripe-${Date.now()}-${name}.json`);
    fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
  } catch { /* ignore */ }
}

router.post("/", rawParser, (req: Request, res: Response) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || (CFG as any)?.stripeWebhookSecret || "";
  if (!secret) {
    logEvent("error-missing-secret", { headers: req.headers });
    return res.status(500).json({ ok:false, error:"stripe-webhook-misconfigured" });
  }

  const sig = req.header("stripe-signature");
  if (!verifyStripeSig(req.body as Buffer, sig, secret)) {
    logEvent("bad-signature", { headers: req.headers, body: req.body.toString("utf8") });
    return res.status(400).json({ ok:false, error:"bad-signature" });
  }

  // parse event AFTER verifying signature
  let event: any;
  try { event = JSON.parse(req.body.toString("utf8")); }
  catch { return res.status(400).json({ ok:false, error:"invalid-json" }); }

  const type = event?.type || "unknown";
  logEvent(type, event); // debug drop

  // If plan engine exists, hand off (safe-optional)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flags = require("../shared/plan-flags");
    if (flags && typeof flags.applyStripeEvent === "function") {
      flags.applyStripeEvent(event);
    }
  } catch { /* optional */ }

  return res.json({ ok:true, received:true, type, id:event?.id || null });
});

export default router;