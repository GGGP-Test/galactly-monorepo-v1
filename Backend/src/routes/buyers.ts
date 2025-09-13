// src/routes/buyers.ts
import { Router } from "express";

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body: { domain: string, region?: string, radiusMi?: number, persona?: {...} }
 *
 * For now: validate inputs and return an empty but successful result,
 * so the UI stops 500ing. Real discovery hooks can be wired next.
 */
router.post("/api/v1/leads/find-buyers", async (req, res) => {
  try {
    const { domain } = req.body || {};
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    // TODO: plug discovery + BLEED store here; keep it fast/clean for now.
    return res.json({
      ok: true,
      created: 0,
      hot: 0,
      warm: 0,
      note: `Discovery stub OK for ${domain}.`,
    });
  } catch (err: any) {
    console.error("[buyers] find-buyers failed:", err?.stack || err);
    return res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;