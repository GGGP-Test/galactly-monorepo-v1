import { Router, Request, Response } from "express";
import { runProviders } from "../providers";
import type { FindBuyersInput } from "../providers/types";

const router = Router();

// POST /api/v1/leads/find-buyers
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<FindBuyersInput>;

    const supplier = String(body.supplier ?? "").trim();
    if (!supplier) {
      return res
        .status(400)
        .json({ ok: false, error: "supplier (domain) is required" });
    }

    const region = String(body.region ?? "usca").toLowerCase();
    const radiusMiNum = Number(body.radiusMi);
    const radiusMi = Number.isFinite(radiusMiNum) ? radiusMiNum : 50;

    const persona = {
      offer: body.persona?.offer ?? "",
      solves: body.persona?.solves ?? "",
      // allow string or string[]
      titles: Array.isArray(body.persona?.titles)
        ? body.persona!.titles.join(", ")
        : body.persona?.titles ?? ""
    };

    const input: FindBuyersInput = { supplier, region, radiusMi, persona };

    const t0 = Date.now();
    const out = await runProviders(input);

    const candidates = out?.candidates ?? [];
    const hot = candidates.filter(c => c.temp === "hot").length;
    const warm = candidates.filter(c => c.temp === "warm").length;

    const payload = {
      ok: true,
      created: candidates.length,
      candidates,
      meta: {
        ...(out?.meta ?? {}),
        hot,
        warm,
        ms: Date.now() - t0 // set ms last to avoid duplicate-key warnings
      }
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err ?? "unexpected error")
    });
  }
});

export default router;