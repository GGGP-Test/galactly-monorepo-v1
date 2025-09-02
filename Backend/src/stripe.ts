import type express from 'express';
import Stripe from 'stripe';
import { q } from './db';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PRICE_ID = process.env.STRIPE_PRICE_ID || ''; // price id for $39/mo
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || '').replace(/\/+$/,'');
const SUCCESS_URL = process.env.SUCCESS_URL || (FRONTEND_BASE ? `${FRONTEND_BASE}/billing-success.html` : 'https://example.com/billing-success.html');
const CANCEL_URL  = process.env.CANCEL_URL  || (FRONTEND_BASE ? `${FRONTEND_BASE}/billing-canceled.html` : 'https://example.com/billing-canceled.html');

const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY, { apiVersion: '2024-06-20' }) : (null as any);

/** Mount webhook BEFORE express.json() so we can verify the raw body */
export function mountStripeWebhook(app: express.Express){
  app.post('/api/v1/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !WEBHOOK_SECRET) return res.status(501).end(); // not configured
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try{
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = String(session.metadata?.xGalUser || '');
          if (userId) {
            // flip plan → pro; keep other prefs intact
            await q(
              `UPDATE app_user
                 SET user_prefs = jsonb_set(
                       COALESCE(user_prefs,'{}'::jsonb),
                       '{plan}',
                       to_jsonb('pro'::text)
                     ),
                     updated_at=now()
               WHERE id=$1`,
              [userId]
            );
          }
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.created': {
          // You can extend to store stripe customer/subscription ids if needed
          break;
        }
        case 'customer.subscription.deleted': {
          // Optional: downgrade plan on cancellation
          break;
        }
      }
    }catch(e){
      // swallow errors to avoid webhook retries looping forever
    }

    res.json({ received: true });
  });
}

/** Mount normal JSON endpoints AFTER express.json() */
export function mountStripeApi(app: express.Express){
  // Create checkout session
  app.post('/api/v1/checkout', async (req, res) => {
    try{
      const userId = (req as any).userId || null;
      if (!userId) return res.status(400).json({ ok:false, error:'missing x-galactly-user' });
      if (!stripe || !PRICE_ID) return res.status(500).json({ ok:false, error:'stripe not configured' });

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: PRICE_ID, quantity: 1 }],
        success_url: SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: CANCEL_URL,
        metadata: { xGalUser: userId }
      });

      res.json({ ok:true, url: session.url });
    }catch(e:any){
      res.status(500).json({ ok:false, error: e?.message || 'checkout_failed' });
    }
  });
}
