import { Router } from "express";
import runDiscovery from "../buyers/discovery";
import runPipeline from "../buyers/pipeline";

const router = Router();

/**
 * ----------------------------------------------------------------
 * Tiny in-memory store (enough for the Free Panel lists)
 * ----------------------------------------------------------------
 */
type Lead = {
  id: string;
  host: string;
  title: string;
  temperature: "hot" | "warm";
  whyText?: string;
  why?: any;
  created: string;            // ISO string
  platform?: string;
  region?: "us" | "ca";
};
const leadsDB: Lead[] = [];

function dedupeKey(l: Pick<Lead, "host" | "title">) {
  return `${l.host.toLowerCase()}|${l.title.trim().toLowerCase()}`;
}

function hostnameFrom(domainOrUrl?: string): string {
  if (!domainOrUrl) return "unknown";
  try {
    const u = domainOrUrl.startsWith("http")
      ? new URL(domainOrUrl)
      : new URL(`https://${domainOrUrl}`);
    return u.hostname || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Optional API key guard. If no key set, it's a no-op.
 */
router.use((req, res, next) => {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return next();
  const got = req.header("x-api-key");
  if (got !== need) return res.status(401).json({ ok: false, error: "invalid api key" });
  next();
});

/**
 * ----------------------------------------------------------------
 * GET /api/v1/leads
 * Lists stored leads with optional filters:
 *   ?temp=hot|warm
 *   ?region=us|ca|usca  (default: usca)
 * ----------------------------------------------------------------
 * NOTE: This router is mounted at /api/v1/leads in your server,
 * so this handler is registered at GET /api/v1/leads
 * ----------------------------------------------------------------
 */
router.get("/", async (req, res) => {
  const tempQ = String(req.query.temp || "").toLowerCase();
  const regionQ = String(req.query.region || "usca").toLowerCase();

  const allowedRegions =
    regionQ === "us" ? ["us"] :
    regionQ === "ca" ? ["ca"] : ["us", "ca"];

  const items = leadsDB.filter((l) => {
    const okTemp = !tempQ || l.temperature === tempQ;
    const okRegion = !l.region || allowedRegions.includes(l.region);
    return okTemp && okRegion;
  });

  return res.json({ items });
});

/**
 * ----------------------------------------------------------------
 * POST /api/v1/leads/find-buyers
 * Runs discovery + pipeline, normalizes, de-dupes and stores leads.
 * Returns both the mapped candidates and how many were created.
 * ----------------------------------------------------------------
 */
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;
      region?: string;        // "us" | "ca" | "usca"
      radiusMi?: number;
      persona?: any;
    };

    if (!body.supplier || body.supplier.length < 3) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const supplier = body.supplier.trim().toLowerCase();
    const regionIn = (body.region || "us").trim().toLowerCase();
    // we store per-lead region as a single country for filtering; pick one if 'usca'
    const region: "us" | "ca" =
      regionIn === "ca" ? "ca" : "us";
    const radiusMi =
      typeof body.radiusMi === "number" && Number.isFinite(body.radiusMi) && body.radiusMi >= 0
        ? Math.floor(body.radiusMi)
        : 50;
    const persona = body.persona;

    // 1) Discovery: infer persona/latents + sources (cheap; cached inside module)
    const discovery = await runDiscovery({ supplier, region, persona });

    // 2) Pipeline: hit public directories/search and rank
    const { candidates = [] } = await runPipeline(discovery, { region, radiusMi });

    /**
     * Normalize for the docs/panel AND produce a Lead[] we can persist.
     * We try to populate title/host/why from whatever evidence the adapter provided.
     */
    const normalized = candidates.map((c: any) => {
      const score = typeof c.score === "number" ? c.score : 0.5;
      const temperature: "hot" | "warm" = score >= 0.65 ? "hot" : "warm";

      const website = c.website || (c.domain ? (c.domain.startsWith("http") ? c.domain : `https://${c.domain}`) : undefined);
      const host = hostnameFrom(website) || hostnameFrom(c.domain) || "unknown";

      const evidenceTitle =
        c?.title ||
        c?.reason ||
        c?.evidence?.[0]?.detail?.title ||
        c?.evidence?.[0]?.topic ||
        c?.company ||
        c?.name ||
        (host !== "unknown" ? host : "Candidate");

      const why = {
        signal: {
          label: temperature === "hot" ? "Opening/launch signal" : "Expansion signal",
          score,
          detail: evidenceTitle,
        },
        context: {
          label: c.source || "Pipeline",
          detail: c.source || "",
        },
      };

      return {
        mapped: {
          name: c.company || c.name || c.domain,
          website,
          region,
          score,
          temperature,
          source: c.source || "UNKNOWN",
          reason: evidenceTitle,
        },
        lead: {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          host,
          title: evidenceTitle,
          temperature,
          whyText: evidenceTitle,
          why,
          created: new Date().toISOString(),
          platform: "news",
          region,
        } as Lead,
      };
    });

    // 3) dedupe by (host|title) within the in-memory DB
    const existing = new Set(leadsDB.map((l) => dedupeKey(l)));
    const toInsert: Lead[] = [];
    for (const n of normalized) {
      const key = dedupeKey(n.lead);
      if (!existing.has(key)) {
        existing.add(key);
        toInsert.push(n.lead);
      }
    }
    if (toInsert.length) leadsDB.push(...toInsert);

    const created = toInsert.length;

    // For the panel "Created X candidates..." message and quick preview
    const mapped = normalized.map((n) => n.mapped);
    const okReal = mapped.some((x) => x.source && x.source !== "DEMO_SOURCE");

    return res.status(200).json({
      ok: true,
      supplier: discovery.supplierDomain,
      persona: persona ?? discovery.persona,
      latents: discovery.latents,
      archetypes: discovery.archetypes,
      candidates: mapped,
      created,
      cached: discovery.cached,
      message: okReal
        ? (created ? `Created ${created} candidate(s).` : "No new candidates (deduped).")
        : "ok=true but empty → only demo candidates; discovery sources may be constrained.",
    });
  } catch (e: any) {
    console.error("[find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

export default router;
