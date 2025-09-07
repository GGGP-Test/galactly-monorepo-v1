import express, { Request, Response } from 'express';
import Stripe from 'stripe';

export function registerStripeWebhook(app: express.Express) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;

  // Always register a route; if keys are missing, return 204 so deploys aren't blocked
  if (!key || !secret) {
    console.warn('[stripe] keys not configured; webhook will be a no-op');
    app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (_req: Request, res: Response) => {
      res.status(204).end();
    });
    return;
  }

  const stripe = new Stripe(key, { apiVersion: '2024-06-20' as any });

  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    const sig = req.header('stripe-signature');
    if (!sig) return res.status(400).send('Missing signature');

    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, secret);
      // TODO: handle event types
      res.json({ received: true, type: event.type });
    } catch (err: any) {
      console.error('[stripe] signature verification failed:', err?.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });
}
