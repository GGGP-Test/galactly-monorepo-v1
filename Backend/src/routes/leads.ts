import { Router } from "express";
import { z } from "zod";
import runDiscovery from "../buyers/discovery";
import runPipeline from "../buyers/pipeline";

const router = Router();

// Optional API key guard. If no key set, it's a no-op (keeps local/dev easy).
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

const FindBuyersReq = z.object({
  supplier: z.string().min(3, "supplier domain is required"),
  region: z.string().min(2).default("us"),
  radiusMi: z.number().int().nonnegative().default(50),
  persona: z
    .object({
      offer: z.string().optional().default(""),
      solves: z.string().optional().default(""),
      titles: z.string().optional().default(""),
    })
    .partial()
    .optional(),
});

// POST /api/v1/leads/find-buyers
router.post("/find-buyers", async (req, res) => {
  try {
    const parsed = FindBuyersReq.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: parsed.error.flatten() });
    }
    const { supplier, region, radiusMi, persona } = parsed.data;

    // 1) Discovery: infer persona/latents + sources (cheap; cached inside module)
    const discovery = await runDiscovery({ supplier, region, persona });

    // 2) Pipeline: hit public directories/search and rank
    const { candidates } = await runPipeline(discovery, { region, radiusMi });

    // Normalize to panel-friendly shape
    const mapped = (candidates || []).map((c) => ({
      name: (c as any).company || (c as any).name || (c as any).domain,
      website: (c as any).domain
        ? ((c as any).domain.startsWith("http") ? (c as any).domain : `https://${(c as any).domain}`)
        : undefined,
      region: (c as any).region || region,
      score: typeof (c as any).score === "number" ? (c as any).score : 0.5,
      temperature: (typeof (c as any).score === "number" ? (c as any).score : 0.5) >= 0.65 ? "hot" : "warm",
      source: (c as any).source || "UNKNOWN",
      reason:
        (c as any).evidence && (c as any).evidence.length
          ? ((c as any).evidence[0].detail?.title || (c as any).evidence[0].topic || "evidence")
          : undefined,
    }));

    const okReal = mapped.some((x) => x.source !== "DEMO_SOURCE");

    return res.status(200).json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: persona ?? discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      cached: discovery.cached,
      message: okReal
        ? "Candidates discovered."
        : "ok=true but empty → only demo candidates; discovery sources may be constrained.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;
