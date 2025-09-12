import type { Request, Response } from 'express';
import type { App } from '../index';

export function mountBuyers(app: App) {
  app.post('/api/v1/buyers', async (req: Request, res: Response) => {
    const { supplierDomain } = (req.body || {}) as { supplierDomain?: string };
    res.json({ ok: true, supplierDomain: supplierDomain ?? null, buyers: [] });
  });
}
