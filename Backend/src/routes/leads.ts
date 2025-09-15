import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import runPipeline from "../buyers/pipeline";

const router = Router();

// Optional API key guard. If no key set, it's a no-op.
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

// POST /api/v1/leads/find-buyers
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;
      radiusMi?: number;
      persona?: any;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const supplier = body.supplier.trim();
    const region = (body.region || "us").trim();
    const radiusMi =
      typeof body.radiusMi === "number" && Number.isFinite(body.radiusMi) && body.radiusMi >= 0
        ? Math.floor(body.radiusMi)
        : 50;
    const persona = body.persona;

    // 1) Discovery: infer persona/latents + sources (cheap; cached inside module)
    const discovery = await runDiscovery({ supplier, region, persona });

    // 2) Pipeline: hit public directories/search and rank
    const { candidates } = await runPipeline(discovery, { region, radiusMi });

    // Normalize for the docs/ panel
    const mapped = (candidates || []).map((c: any) => ({
      name: c.company || c.name || c.domain,
      website: c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : undefined,
      region: c.region || region,
      score: typeof c.score === "number" ? c.score : 0.5,
      temperature: typeof c.score === "number" && c.score >= 0.65 ? "hot" : "warm",
      source: c.source || "UNKNOWN",
      reason: c?.evidence?.[0]?.detail?.title || c?.evidence?.[0]?.topic,
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
