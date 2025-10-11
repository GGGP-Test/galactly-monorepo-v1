// src/routes/stripe-webhook.ts
import express from "express";
import Stripe from "stripe";

const router = express.Router();

// IMPORTANT: use your **TEST** secret while testing (sk_test_...)
// and the **TEST** webhook signing secret (whsec_...) from the Stripe dashboard.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

// This route must receive the RAW body (not JSON-parsed)
router.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"] as string;

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,                           // raw bytes
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!  // whsec_... (TEST while testing)
      );

      // (Keep it fast; enqueue/flag by type)
      // Minimal no-op handling so the endpoint returns 200:
      switch (event.type) {
        case "checkout.session.completed":
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "invoice.paid":
          // TODO: later: mark user plan=pro, add VIP addon if present, etc.
          break;
        default:
          break;
      }

      return res.sendStatus(200);
    } catch (err: any) {
      console.error("Stripe webhook verify failed:", err?.message || err);
      return res.status(400).send(`Webhook Error: ${err?.message || "bad sig"}`);
    }
  }
);

export default router;