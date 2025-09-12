import type { Request, Response } from 'express';
import type { App } from '../index';

type FindBody = {
  productOffer?: string;
  solves?: string;
  buyerTitles?: string[];
  persona?: {
    productOffer?: string;
    solves?: string;
    buyerTitles?: string[];
  };
  targets?: string[];
};

export function mountFind(app: App) {
  app.post('/api/v1/find', async (req: Request<unknown, unknown, FindBody>, res: Response) => {
    const { productOffer, solves, buyerTitles, persona, targets } = req.body || {};
    res.json({
      ok: true,
      productOffer: productOffer ?? persona?.productOffer ?? null,
      solves: solves ?? persona?.solves ?? null,
      buyerTitles: buyerTitles ?? persona?.buyerTitles ?? [],
      targets: targets ?? []
    });
  });
}
