import { Application, Request, Response } from "express";

// We keep this loose so builds don't break if the AI module shape changes.
import * as webscout from "../ai/webscout";

/**
 * POST /api/v1/leads/find-buyers
 * Body:
 *   {
 *     "supplier": "stretchandshrink.com",        // required (domain or url)
 *     "region": "us" | "ca" | "us/ca" | "us-ca", // optional, default "us"
 *     "radius": "50 mi",                         // optional, default "50 mi"
 *     "persona": { product: "...", solves: "..." }, // optional (human-edited persona)
 *     "titles": "Warehouse Manager, Purchasing", // optional
 *     "city": "San Francisco",                   // optional
 *     "lat": 37.77, "lng": -122.42               // optional (if city not provided)
 *   }
 */
export function mountBuyers(app: Application): void {
  app.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, any>;
      const supplier = (body.supplier ?? "").toString().trim();

      if (!supplier) {
        return res.status(400).json({ ok: false, error: "Missing required field: supplier (domain or URL)." });
      }

      const region = (body.region ?? "us").toString().toLowerCase();
      const radius = (body.radius ?? "50 mi").toString();
      const persona = body.persona ?? null;
      const titles = typeof body.titles === "string" ? body.titles : null;
      const city = typeof body.city === "string" ? body.city : null;
      const lat = typeof body.lat === "number" ? body.lat : null;
      const lng = typeof body.lng === "number" ? body.lng : null;

      // Prefer the AI/web scout if present.
      const hasFind = (webscout as any)?.findBuyers && typeof (webscout as any).findBuyers === "function";

      if (!hasFind) {
        // Failsafe: service is up, but AI module not wired yet.
        return res.status(501).json({
          ok: false,
          error: "Buyers scout is not available on this build.",
          hint: "Ensure ../ai/webscout.ts exports async function findBuyers(params).",
        });
      }

      const output = await (webscout as any).findBuyers({
        supplier,
        region,
        radius,
        persona,
        titles,
        city,
        lat,
        lng,
      });

      return res.status(200).json({ ok: true, ...output });
    } catch (err: any) {
      const status = Number(err?.status || 500);
      return res.status(status).json({
        ok: false,
        error: err?.message || "Failed to find buyers.",
      });
    }
  });
}

export default mountBuyers;
