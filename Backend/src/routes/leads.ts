// src/routes/leads.ts
import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import { runPipeline } from "../buyers/pipeline";
import {
  StoredLead,
  Temp,
  buckets,
  resetHotWarm,
  replaceHotWarm,
} from "../shared/memStore";

const router = Router();

// Health
router.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Optional API key guard (for write routes)
function hasValidKey(req: any) {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return true;
  const got = req.header("x-api-key") || req.header("X-Api-Key");
  return got === need;
}

// === GET /api/v1/leads?temp=hot|warm|saved ==================================
router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  let items: StoredLead[] = [];
  if (temp === "hot") items = buckets.hot;
  else if (temp === "saved") items = buckets.saved;
  else items = buckets.warm;
  res.json({ ok: true, items });
});

// === POST /api/v1/leads/find-buyers  ========================================
router.post("/find-buyers", async (req, res) => {
  // write requires key if configured
  if (!hasValidKey(req)) return res.status(401).json({ ok: false, error: "invalid api key" });

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

    // 1) discovery
    const discovery = await runDiscovery({
      supplier: body.supplier.trim(),
      region: (body.region || "us").trim(),
      persona: body.persona,
    });

    // 2) pipeline
    const excludeEnterprise =
      String(process.env.EXCLUDE_ENTERPRISE || "true").toLowerCase() === "true";

    const { candidates } = await runPipeline(discovery, {
      region: discovery ? (body.region || "us") : body.region,
      radiusMi: body.radiusMi || 50,
      excludeEnterprise,
    });

    // 3) normalize
    const toLead = (c: any): StoredLead => {
      const title = c?.evidence?.[0]?.detail?.title || "";
      const link = c?.evidence?.[0]?.detail?.url || "";
      const host = link
        ? new URL(link).hostname.replace(/^www\./, "")
        : c.domain || "unknown";
      const why = {
        signal: {
          label: c.score >= 0.65 ? "Opening/launch signal" : "Expansion signal",
          score: Number((c.score || 0).toFixed(2)),
          detail: title,
        },
        context: {
          label: c.source?.startsWith("rss") ? "News (RSS)" : "News (Google)",
          detail: c.source || "google-news",
        },
      };
      const temp: Temp = c.temperature === "hot" ? "hot" : "warm";
      return {
        id: 0, // will be ignored for hot/warm buckets
        host,
        platform: "news",
        title,
        created: new Date().toISOString(),
        temperature: temp,
        whyText: title,
        why,
      };
    };

    // 4) store for panel
    const mapped: StoredLead[] = (candidates || []).map(toLead);
    resetHotWarm();
    replaceHotWarm(mapped);

    const nHot = buckets.hot.length;
    const nWarm = buckets.warm.length;

    res.json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      cached: discovery.cached,
      created: mapped.length,
      message: `Created ${mapped.length} candidate(s). Hot:${nHot} Warm:${nWarm}.`,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

// (optional) clear everything but saved
router.post("/__clear", (req, res) => {
  if (!hasValidKey(req)) return res.status(401).json({ ok: false, error: "invalid api key" });
  resetHotWarm();
  res.json({ ok: true });
});

export default router;