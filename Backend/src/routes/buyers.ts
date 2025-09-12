// src/routes/buyers.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body: { domain: string, region?: string, radiusMi?: number }
 * - Validates input
 * - (Minimal stub for now) responds OK so the UI can proceed
 *   Next step is to plug this into your discovery pipeline + BLEED store.
 */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const { domain, region, radiusMi } = (req.body ?? {}) as {
      domain?: unknown;
      region?: unknown;
      radiusMi?: unknown;
    };

    // Basic validation to match what the panel expects
    if (typeof domain !== "string" || !domain.trim() || !domain.includes(".")) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    // Normalized inputs (kept for later pipeline stages)
    const norm = {
      domain: domain.trim().toLowerCase(),
      region: typeof region === "string" ? region : "us/ca",
      radiusMi: typeof radiusMi === "number" ? radiusMi : 50,
    };

    // TODO (next step): call discovery → write candidates to BLEED store, return counts
    // For now, return a shape the UI can consume without blowing up.
    return res.json({
      ok: true,
      created: 0,
      hot: 0,
      warm: 0,
      inputs: norm,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Express expects a middleware function; default-export a Router.
// (Helps whether your index uses import or require)
export default router;
// Also provide a named export for convenience if you ever need it.
export { router };
