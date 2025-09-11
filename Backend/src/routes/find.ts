import { Application, Request, Response } from "express";
import * as webscout from "../ai/webscout";

/**
 * Lightweight "find" routes.
 * - POST /api/v1/find/buyers  (alias of /api/v1/leads/find-buyers)
 * - GET  /api/v1/find/ping    (debug)
 */
export function mountFind(app: Application): void {
  // Alias to buyers endpoint for legacy/front-end compatibility.
  app.post("/api/v1/find/buyers", async (req: Request, res: Response) => {
    try {
      const hasFind = (webscout as any)?.findBuyers && typeof (webscout as any).findBuyers === "function";
      if (!hasFind) {
        return res.status(501).json({
          ok: false,
          error: "Buyers scout is not available on this build.",
          hint: "Ensure ../ai/webscout.ts exports async function findBuyers(params).",
        });
      }
      const output = await (webscout as any).findBuyers(req.body ?? {});
      return res.status(200).json({ ok: true, ...output });
    } catch (err: any) {
      return res.status(Number(err?.status || 500)).json({
        ok: false,
        error: err?.message || "Failed to find buyers.",
      });
    }
  });

  // Simple probe
  app.get("/api/v1/find/ping", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, route: "find", time: new Date().toISOString() });
  });
}

export default mountFind;
