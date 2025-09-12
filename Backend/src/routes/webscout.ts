import type { Application, Request, Response } from "express";

function mountWebscout(app: Application) {
  app.post("/api/v1/webscout", async (req: Request, res: Response) => {
    // Stubbed handler; replace with real implementation later.
    res.json({ ok: true, source: "webscout", received: req.body ?? null });
  });
}

export default mountWebscout;
export { mountWebscout };
