import { Router, Request, Response } from "express";
import { runProviders } from "../providers";
// Import types only for compile-time; keep them flexible to match your current providers/types.
import type { FindBuyersInput } from "../providers/types";

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body: Partial<FindBuyersInput>
 *   {
 *     supplier: string,              // required
 *     region?: string,               // e.g. "usca"
 *     radiusMi?: number,             // e.g. 50
 *     persona?: { offer?: string, solves?: string, titles?: string | string[] }
 *   }
 */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<FindBuyersInput>;

    const supplier = (body as any).supplier ?? "";
    if (!supplier || typeof supplier !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "supplier (domain) is required" });
    }

    // Normalize persona.titles to a comma-separated string (accept string or string[])
    const persona = body.persona ?? {};
    const titles =
      Array.isArray((persona as any).titles)
        ? (persona as any).titles.join(", ")
        : (persona as any).titles ?? "";

    // Build a tolerant input that matches your providers’ expected shape
    const input: FindBuyersInput = {
      supplier,
      region: String(body.region ?? "usca").toLowerCase(),
      radiusMi: Number(body.radiusMi ?? 50),
      persona: {
        offer: (persona as any).offer ?? "",
        solves: (persona as any).solves ?? "",
        // If your providers expect string[], they can split; if they expect string, it's already a string.
        titles, 
      } as any,
    } as any;

    const t0 = Date.now();
    const { candidates, meta } = await runProviders(input);

    // Compute temps without relying on strict typings (avoid "temp" missing type errors)
    const hot = (candidates as any[]).filter((c) => c?.temp === "hot").length;
    const warm = (candidates as any[]).filter((c) => c?.temp === "warm").length;

    // Avoid duplicate keys by namespacing counts
    const payload = {
      ok: true,
      created: Array.isArray(candidates) ? candidates.length : 0,
      candidates,
      meta: {
        ms: Date.now() - t0,
        counts: { hot, warm },
        ...(meta ?? {}),
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