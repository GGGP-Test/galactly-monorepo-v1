import type { Express, Request, Response } from 'express';
import Stripe from 'stripe';

// Read your secret from env. Keep the name exactly STRIPE_SECRET in Render.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

export function mountBilling(app: Express) {
  // If Stripe isn’t configured yet, mount a safe stub.
  if (!STRIPE_SECRET_KEY) {
    app.post('/api/v1/billing/create-checkout-session', (_req: Request, res: Response) => {
      res.status(503).json({ ok: false, error: 'Stripe not configured' });
    });
    return;
  }

  // Don’t pass apiVersion — avoids TypeScript literal mismatch errors.
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  // Create a Checkout Session (works for one-time or subscription prices).
  app.post('/api/v1/billing/create-checkout-session', async (req: Request, res: Response) => {
    try {
      const {
        priceId,
        mode = 'subscription',              // 'subscription' or 'payment'
        successUrl,
        cancelUrl,
        customerEmail
      } = req.body || {};

      if (!priceId) {
        return res.status(400).json({ ok: false, error: 'priceId required' });
      }

      const session = await stripe.checkout.sessions.create({
        mode: mode as 'subscription' | 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl || `${process.env.SITE_ORIGIN || 'https://example.com'}/?paid=1`,
        cancel_url:  cancelUrl  || `${process.env.SITE_ORIGIN || 'https://example.com'}/billing-canceled.html`,
        customer_email: customerEmail || undefined,
        allow_promotion_codes: true
      });

      res.json({ ok: true, url: session.url });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
