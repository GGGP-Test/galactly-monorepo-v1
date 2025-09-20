import { Router, Request, Response } from "express";
import { runProviders } from "../providers";

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body:
 * {
 *   supplier: string,                       // required
 *   region?: string,                        // default "usca"
 *   radiusMi?: number,                      // default 50
 *   persona?: { offer?: string, solves?: string, titles?: string | string[] }
 * }
 */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, any>;
    const supplier = body.supplier ?? "";

    if (!supplier || typeof supplier !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "supplier (domain) is required" });
    }

    // Normalize persona.titles: allow string or string[]
    const persona = body.persona ?? {};
    const titles = Array.isArray(persona.titles)
      ? persona.titles.join(", ")
      : (persona.titles ?? "");

    // Build tolerant input (we’ll cast to any when calling providers)
    const input = {
      supplier,
      region: String(body.region ?? "usca").toLowerCase(),
      radiusMi: Number(body.radiusMi ?? 50),
      persona: {
        offer: persona.offer ?? "",
        solves: persona.solves ?? "",
        titles, // normalized string
      },
    };

    const t0 = Date.now();
    // Avoid cross-module type mismatches by casting once here
    const { candidates = [], meta = {} } = (await runProviders(input as any)) as any;

    // Compute counts without assuming candidate type
    const hot = (candidates as any[]).filter((c) => c?.temp === "hot").length;
    const warm = (candidates as any[]).filter((c) => c?.temp === "warm").length;

    // Keep hot/warm out of the same object as potential existing meta keys
    const payload = {
      ok: true,
      created: Array.isArray(candidates) ? candidates.length : 0,
      counts: { hot, warm },
      candidates,
      meta: {
        ms: Date.now() - t0,
        ...(meta || {}),
      },
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message ?? err ?? "unexpected error"),
    });
  }
});

export default router;