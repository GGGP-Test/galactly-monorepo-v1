import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import runPipeline from "../buyers/pipeline";

// ---- Types & in-memory store ----------------------------------------------
type Temp = "hot" | "warm";
type Lead = {
  id: number;
  host: string;
  platform?: string;
  title?: string;
  created: string; // ISO
  temperature: Temp;
  why?: any;
  whyText?: string;
};

let seq = 1;
const store = {
  hot: [] as Lead[],
  warm: [] as Lead[],
};

function sanitizeHost(v: string): string {
  const s = (v || "").trim();
  return s.replace(/^https?:\/\//, "").replace(/\/.*/, "") || "unknown";
}

function mapCandidateToLead(c: any): Omit<Lead, "id"> {
  const score = typeof c?.score === "number" ? c.score : 0.33;
  const temperature: Temp = score >= 0.65 ? "hot" : "warm";
  const host = sanitizeHost(c?.domain || c?.host || "");
  const title = c?.title || c?.reason || c?.name || "";
  const whyText =
    c?.reason ||
    c?.evidence?.[0]?.detail?.title ||
    c?.evidence?.[0]?.topic ||
    "";
  const why = c?.evidence?.[0]
    ? {
        signal: {
          label: c.evidence[0].topic || "signal",
          score,
          detail: c.evidence[0].detail?.title || c.evidence[0].detail || "",
        },
        context: { label: "Pipeline", detail: c.source || "" },
      }
    : undefined;

  return {
    host,
    platform: c?.platform,
    title,
    created: new Date().toISOString(),
    temperature,
    why,
    whyText,
  };
}

function upsertLead(temp: Temp, lead: Omit<Lead, "id">) {
  const arr = temp === "hot" ? store.hot : store.warm;
  const key = `${lead.host}::${lead.title || ""}`;
  const existing = arr.find((x) => `${x.host}::${x.title || ""}` === key);
  if (existing) return existing;

  const full: Lead = { id: seq++, ...lead };
  arr.unshift(full);
  if (arr.length > 200) arr.length = 200; // cap
  return full;
}

function listLeads(temp: Temp) {
  return (temp === "hot" ? store.hot : store.warm).slice(0, 200);
}

// ---- Router ---------------------------------------------------------------
const router = Router();

// Optional API key guard. If not set, it's a no-op.
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

// Health
router.get("/ping", (_req, res) =>
  res.json({ ok: true, service: "leads", ts: new Date().toISOString() })
);

// GET /api/v1/leads  (with or without ?temp=)
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.temp || "").toLowerCase();
    if (q === "hot" || q === "warm") {
      return res.json({ ok: true, items: listLeads(q as Temp) });
    }
    // No temp provided: return usage instead of throwing a 500
    return res.status(200).json({
      ok: true,
      message: "Append ?temp=hot or ?temp=warm",
      endpoints: [
        "GET  /api/v1/leads?temp=hot",
        "GET  /api/v1/leads?temp=warm",
        "POST /api/v1/leads/find-buyers",
        "GET  /api/v1/leads/ping",
      ],
      counts: { hot: store.hot.length, warm: store.warm.length },
    });
  } catch (e: any) {
    console.error("[leads:list:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
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

    const supplier = body.supplier.trim().toLowerCase();
    const region = (body.region || "us").trim();
    const radiusMi =
      typeof body.radiusMi === "number" && Number.isFinite(body.radiusMi) && body.radiusMi >= 0
        ? Math.floor(body.radiusMi)
        : 50;
    const persona = body.persona;

    // 1) Discovery (persona & latents)
    const discovery = await runDiscovery({ supplier, region, persona });

    // 2) Pipeline (directories/search → candidates)
    const { candidates } = await runPipeline(discovery, { region, radiusMi });

    // 3) Normalize + store so the panel Refresh buttons can retrieve them
    const mapped = (candidates || []).map(mapCandidateToLead);

    let created = 0;
    for (const m of mapped) {
      const put = upsertLead(m.temperature, m);
      if (put) created++;
    }

    return res.status(200).json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: persona ?? discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      created,
      candidates: mapped,
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;