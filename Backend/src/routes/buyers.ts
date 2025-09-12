import type { Application, Request, Response } from "express";

export function mountBuyers(app: Application) {
  app.post("/api/v1/buyers", async (req: Request, res: Response) => {
    // Stubbed; replace with real buyer discovery later.
    res.json({ ok: true, action: "buyers", received: req.body ?? null, buyers: [] });
  });
}
