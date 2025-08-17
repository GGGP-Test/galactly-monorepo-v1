import type { Express } from 'express';
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || process.env.SITE_ORIGIN || 'http://localhost:8787';

// Map plan slugs coming from the frontend to your Stripe Price IDs
const PRICE_BY_PLAN: Record<string, string> = {
  automation: process.env.STRIPE_PRICE_AUTOMATION || '',
  firehose: process.env.STRIPE_PRICE_FIREHOSE || ''
};

export function registerBilling(app: Express){
  if(!STRIPE_SECRET_KEY){
    console.warn('[billing] STRIPE_SECRET_KEY missing — endpoint will 400');
  }
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  app.post('/api/v1/billing/create-session', async (req, res)=>{
    try{
      const { plan = 'automation', userId } = (req as any).body || {};
      const price = PRICE_BY_PLAN[plan];
      if(!STRIPE_SECRET_KEY || !price){
        return res.status(400).json({ error: 'Billing not configured' });
      }
      const success_url = `${FRONTEND_ORIGIN}/engines.html?success=1`;
      const cancel_url  = `${FRONTEND_ORIGIN}/engines.html?canceled=1`;

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url,
        cancel_url,
        metadata: {
          userId: (userId || '').toString()
        }
      });
      return res.json({ url: session.url });
    }catch(err:any){
      console.error('[billing] create-session error', err);
      return res.status(500).json({ error: 'Unable to start checkout' });
    }
  });
}
