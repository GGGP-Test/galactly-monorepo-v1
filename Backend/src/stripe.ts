import express, { type Express, type Request, type Response } from 'express';
import Stripe from 'stripe';

export function registerStripeWebhook(app: Express) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY;

  // If Stripe isn’t configured, skip mounting the route
  if (!webhookSecret || !apiKey) {
    // eslint-disable-next-line no-console
    console.log('Stripe webhook disabled (missing STRIPE_WEBHOOK_SECRET or STRIPE_API_KEY).');
    return;
  }

  const stripe = new Stripe(apiKey, { apiVersion: '2024-06-20' as any });

  app.post(
    '/stripe/webhook',
    // Stripe requires raw body to validate the signature
    express.raw({ type: 'application/json' }),
    (req: Request, res: Response) => {
      const sig = req.headers['stripe-signature'] as string | undefined;
      if (!sig) return res.status(400).send('Missing stripe-signature');

      try {
        const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

        // minimal handler
        switch (event.type) {
          case 'checkout.session.completed':
          case 'invoice.paid':
          case 'customer.subscription.created':
          default:
            break;
        }
        return res.json({ received: true });
      } catch (err: any) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    }
  );
}
