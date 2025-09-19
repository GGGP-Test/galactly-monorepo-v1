import { Router, Request, Response } from "express";
import { runProviders, Candidate, FindBuyersInput } from "../providers";

const router = Router();

// POST /api/v1/leads/find-buyers
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const {
      supplier = "",
      region = "usca",
      radiusMi = 50,
      persona = { offer: "", solves: "", titles: "" }
    } = (req.body || {}) as Partial<FindBuyersInput>;

    if (!supplier || typeof supplier !== "string") {
      return res.status(400).json({ ok: false, error: "supplier (domain) is required" });
    }

    const input: FindBuyersInput = {
      supplier,
      region: String(region || "usca").toLowerCase(),
      radiusMi: Number(radiusMi || 50),
      persona: {
        offer: persona?.offer ?? "",
        solves: persona?.solves ?? "",
        titles: persona?.titles ?? ""
      }
    };

    const t0 = Date.now();
    const { candidates, meta } = await runProviders(input);

    const hot = candidates.filter(c => c.temp === "hot").length;
    const warm = candidates.filter(c => c.temp === "warm").length;

    const payload = {
      ok: true,
      created: candidates.length,
      candidates,
      meta: {
        ms: Date.now() - t0,
        hot,
        warm,
        ...meta
      }
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err || "unexpected error")
    });
  }
});

export default router;