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

// ---------------------------------------------------------------------------
// POST /api/v1/leads/find-buyers
// Body: { supplier, region, radiusMi, persona, provider?, debug? }
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;       // "us", "ca", or "usca"
      radiusMi?: number;
      persona?: any;
      provider?: "google" | "bing" | "both";
      debug?: boolean;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const supplier = body.supplier.trim();
    const regionRaw = (body.region || "us").trim().toLowerCase();
    const region = regionRaw === "ca" ? "ca" : "us"; // normalize 'usca' => 'us'
    const radiusMi =
      typeof body.radiusMi === "number" && Number.isFinite(body.radiusMi) && body.radiusMi >= 0
        ? Math.floor(body.radiusMi)
        : 50;

    // 1) Discovery (persona/latents)
    const discovery = await runDiscovery({ supplier, region, persona: body.persona });

    // 2) Pipeline (with debug + provider plan)
    const { candidates, debug } = await runPipeline(discovery, {
      region,
      radiusMi,
      provider: body.provider || "both",
      debug: body.debug === true,
    });

    // Normalize for panel (optional; panel mostly uses created + candidates count)
    const mapped = (candidates || []).map((c: any) => ({
      name: c.company || c.name || c.domain,
      website: c.domain ? (String(c.domain).startsWith("http") ? c.domain : `https://${c.domain}`) : undefined,
      region,
      score: typeof c.score === "number" ? c.score : 0.5,
      temperature: typeof c.score === "number" && c.score >= 0.65 ? "hot" : "warm",
      source: c.source || "UNKNOWN",
      reason: c?.reason || c?.evidence?.[0]?.detail?.title || c?.evidence?.[0]?.topic,
    }));

    return res.status(200).json({
      ok: true,
      created: mapped.length,
      supplier: discovery.supplierDomain || supplier,
      persona: body.persona ?? discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      cached: (discovery as any).cached,
      debug, // <— visible only if debug=true
      message: mapped.length
        ? "Candidates discovered."
        : "No live signals found right now; try a different supplier or region.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/leads/ping-news  (connectivity probe)
// Optional query: provider=google|bing|both  region=us|ca
router.get("/ping-news", async (req, res) => {
  try {
    const regionRaw = String(req.query.region || "us").toLowerCase();
    const region = regionRaw === "ca" ? "ca" : "us";
    const provider = (String(req.query.provider || "both").toLowerCase() as "google"|"bing"|"both") || "both";

    const discovery = { supplierDomain: "probe", persona: {}, latents: ["warehouse", "distribution center"] } as any;
    const { debug } = await runPipeline(discovery, { region, provider, debug: true, radiusMi: 50 });

    return res.json({ ok: true, debug });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;
