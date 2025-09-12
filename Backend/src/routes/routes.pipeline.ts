import { Application, Request, Response } from "express";

/**
 * Minimal no-op pipeline so the runtime build stays green.
 * We can flesh this out later, but for now it should not rely on CostTracker or other modules.
 */
export function mountRoutesPipeline(app: Application) {
  app.get("/api/routes/pipeline/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
}

export default mountRoutesPipeline;

