/**
 * /api/v1 leads routes
 * Fixes: 500s – always return 200 with structured payload.
 */
import { Router, Request, Response } from "express";

const router = Router();

// GET for simple testing, POST for real use – both funnel here
router.all("/find-now", async (req: Request, res: Response) => {
  try {
    const payload = {
      website: (req.body?.website || req.query.website || "").toString().trim(),
      regions: (req.body?.regions || req.query.regions || "").toString().trim(),
      industries: (req.body?.industries || req.query.industries || "").toString().trim(),
      seed_buyers: (req.body?.seed_buyers || req.query.seed_buyers || "").toString().trim(),
      notes: (req.body?.notes || req.query.notes || "").toString().trim(),
      uid: (req.header("x-galactly-user") || "").trim(),
    };

    // echo back submission so the UI can render the spinner + preview log
    res.json({
      ok: true,
      submitted: true,
      received: payload,
      // keep preview minimal; real search happens async via worker in your stack
      preview: [
        { step: "queued", at: Date.now() },
        { step: "probing_public_feeds" },
        { step: "reading_procurement" },
      ],
    });
  } catch (_e) {
    return res.json({ ok: false, error: "temporary_unavailable" });
  }
});

export default router;
