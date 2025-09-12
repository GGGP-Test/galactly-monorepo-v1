import type { Application, Request, Response } from "express";

export function mountFind(app: Application) {
  app.post("/api/v1/find", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as any;

    const payload = {
      productOffer: body.productOffer ?? null,
      solves: body.solves ?? null,
      buyerTitles: Array.isArray(body.buyerTitles) ? body.buyerTitles : [],
      persona: body.persona ?? null,
      targets: Array.isArray(body.targets) ? body.targets : []
    };

    // Stubbed; replace with pipeline call later.
    res.json({ ok: true, action: "find", received: payload });
  });
}
