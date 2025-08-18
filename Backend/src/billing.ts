import type { Express, Request, Response } from 'express';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://gggp-test.github.io/galactly-monorepo-v1/';

export function mountBilling(app: Express) {
  if (!STRIPE_SECRET_KEY) {
    app.post('/api/v1/billing/create-checkout-session', (_req: Request, res: Response) => {
      res.status(503).json({ ok: false, error: 'Stripe not configured' });
    });
    return;
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);

  app.post('/api/v1/billing/create-checkout-session', async (req: Request, res: Response) => {
    try {
      const {
        priceId,
        mode = 'subscription',
        customerEmail
      } = req.body || {};

      if (!priceId) return res.status(400).json({ ok: false, error: 'priceId required' });

      const session = await stripe.checkout.sessions.create({
        mode: mode as 'subscription' | 'payment',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${SITE_ORIGIN}/billing-success.html`,
        cancel_url:  `${SITE_ORIGIN}/billing-canceled.html`,
        customer_email: customerEmail || undefined,
        allow_promotion_codes: true
      });

      res.json({ ok: true, url: session.url });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });
}
