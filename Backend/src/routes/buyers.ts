// src/routes/buyers.ts
import { Router, Request, Response } from "express";

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body: { domain: string, region?: string, radiusMi?: number, persona?: any }
 * NOTE: This is the thin transport layer only. It validates input and returns a JSON result.
 *       The discovery/lead-gen engine can be wired here later (buyer-discovery.ts).
 */
router.post("/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    // CORS preflight is already handled by top-level middleware in index.ts
    // Validate body
    const body = req.body ?? {};
    const domainRaw = (body.domain ?? "").toString().trim();
    const region = (body.region ?? "").toString().trim() || undefined;
    const radiusMi = Number(body.radiusMi ?? body.radius ?? 50) || 50;

    // normalize domain
    const domain = domainRaw
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .toLowerCase();

    if (!domain) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    // TODO: plug in buyer-discovery here.
    // For now, return an empty-but-successful result so the panel stops 500'ing.
    // Keep the shape stable with future engine’s response.
    const result = {
      ok: true,
      supplier: { domain, region, radiusMi },
      created: 0,
      hot: 0,
      warm: 0,
      candidates: [] as Array<any>,
      message: "Created 0 candidate(s). Hot:0 Warm:0. Refresh lists to view.",
    };

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[buyers] find-buyers error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "internal_error" });
  }
});

/**
 * Optional quick ping to verify the router is mounted.
 * GET /api/v1/leads/_buyers-ping
 */
router.get("/leads/_buyers-ping", (_req: Request, res: Response) => {
  res.json({ ok: true, where: "buyers", mounted: true });
});

export default router;