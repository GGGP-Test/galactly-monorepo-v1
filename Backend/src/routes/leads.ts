import { Application, Request, Response } from "express";

/**
 * Tighten types to avoid implicit any on `res`, keep implementation minimal.
 */
export function mountLeads(app: Application) {
  app.get("/api/leads/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
}

export default mountLeads;
