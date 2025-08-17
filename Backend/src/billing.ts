import Stripe from 'stripe';
import type { Express, Request, Response } from 'express';

const API_VERSION: string = process.env.STRIPE_API_VERSION || '2023-10-16';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

export function mountBilling(app: Express) {
  if (!STRIPE_SECRET) {
    // still mount routes, but respond gracefully
    app.post('/api/v1/billing/create-checkout-session', (_req:Request,res:Response)=> {
      res.status(503).json({ ok:false, error:'Stripe not configured' });
    });
    app.post('/api/v1/billing/webhook', (_req:Request,res:Response)=> res.sendStatus(200));
    return;
  }

  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: API_VERSION as any });

  // Create a Checkout Session for a one-time or subscription price
  app.post('/api/v1/billing/create-checkout-session', async (req:Request,res:Response)=>{
    try{
      const { priceId, mode='subscription', successUrl, cancelUrl, customerEmail } = req.body || {};
      if(!priceId) return res.status(400).json({ ok:false, error:'priceId required' });

      const session = await stripe.checkout.sessions.create({
        mode,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl || `${process.env.SITE_ORIGIN || 'https://example.com'}/?paid=1`,
        cancel_url:  cancelUrl  || `${process.env.SITE_ORIGIN || 'https://example.com'}/billing-canceled.html`,
        customer_email: customerEmail || undefined,
        allow_promotion_codes: true
      });
      res.json({ ok:true, url: session.url });
    }catch(e:any){
      res.status(500).json({ ok:false, error: String(e.message||e) });
    }
  });

  // Webhook (optional but recommended)
  // Make sure to set "Use raw body" for this route in Express:
  app.post('/api/v1/billing/webhook', expressRaw(), (req:Request,res:Response)=>{
    if(!WEBHOOK_SECRET) return res.sendStatus(200);
    const sig = req.headers['stripe-signature'] as string;
    try{
      const stripe = new Stripe(STRIPE_SECRET, { apiVersion: API_VERSION as any });
      const evt = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
      // TODO: handle evt.type === 'checkout.session.completed' etc.
      res.sendStatus(200);
    }catch(e){
      return res.status(400).send(`Webhook Error: ${(e as any).message}`);
    }
  });
}

// tiny raw-body helper for the webhook route
import type { RequestHandler } from 'express';
function expressRaw(): RequestHandler {
  return (await import('raw-body')).default
    ? (req:any,res:any,next:any)=>{
        import('raw-body').then(m=>m.default(req)).then((buf:any)=>{ req.body = buf; next(); }).catch(next);
      }
    : ((req:any,_res:any,next:any)=>{ req.body = req; next(); }) as any;
}
