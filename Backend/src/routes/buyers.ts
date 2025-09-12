// src/routes/buyers.ts
import { Router, Request, Response } from "express";

// Types are duplicated locally to avoid import cycles.
// The server must set: app.locals.store = new MemoryBleedStore() or FileBleedStore(...)
type LeadStatus = "new" | "enriched" | "qualified" | "routed" | "contacted" | "won" | "lost" | "archived";
interface LeadRecord {
  id: string;
  tenantId: string;
  source: string;
  company?: string;
  domain?: string;
  website?: string;
  country?: string;
  region?: string;
  verticals?: string[];
  signals?: Record<string, number>;
  scores?: Record<string, number>;
  contacts?: any[];
  status: LeadStatus;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}
interface BleedStore {
  upsertLead(lead: Partial<LeadRecord> & { tenantId: string }): Promise<LeadRecord>;
  updateScores(tenantId: string, id: string, scores: Record<string, number>): Promise<LeadRecord | undefined>;
  addDecision(d: { leadId: string; ts?: number; by: "system" | "user"; type: "APPROVE" | "ROUTE" | "RESCORE"; reason?: string; meta?: Record<string, unknown> }): Promise<any>;
}

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * Body: { domain: string, region?: string, temp?: "hot"|"warm" }
 */
router.post("/api/v1/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const store: BleedStore | undefined = (req.app?.locals?.store as BleedStore | undefined);
    if (!store) {
      return res.status(500).json({ ok: false, error: "lead store not initialized" });
    }

    const apiKey = (req.header("x-api-key") || "").trim();
    const tenantId = apiKey ? `t_${apiKey.slice(0, 8)}` : "t_demo";

    const domain: string | undefined = (req.body?.domain || "").toString().trim().toLowerCase();
    if (!domain) {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }

    const region: string | undefined = (req.body?.region || "").toString().trim();
    const temp: "hot" | "warm" = (req.body?.temp === "hot" ? "hot" : "warm");

    // --- Heuristic candidate generator (placeholder but persists real LeadRecords) ---
    // We bias toward obvious packaging buyers (3PL, distribution, DC-heavy ops).
    const root = rootDomain(domain);
    const supplierName = toCompanyName(root);

    const seedPool = seedBuyersFor(domain);
    const candidates = seedPool.map((c) => ({
      tenantId,
      source: "buyers:heuristic",
      company: c.company,
      domain: c.domain,
      website: `https://${c.domain}`,
      region: region || "US/CA",
      verticals: c.verticals,
      signals: c.signals,
      scores: c.scores,
      status: "new" as LeadStatus,
      meta: { supplier: supplierName, supplierDomain: root, rationale: c.reason },
    }));

    // Upsert into BLEED store
    let created = 0;
    let hot = 0;
    let warm = 0;

    for (const cand of candidates) {
      const rec = await store.upsertLead(cand);
      await store.updateScores(tenantId, rec.id, cand.scores || {});
      await store.addDecision({
        leadId: rec.id,
        by: "system",
        type: "RESCORE",
        reason: "heuristic seed",
        meta: { temp },
      });
      created += 1;
      if ((cand.scores?.intent || 0) >= 0.75) hot += 1;
      else warm += 1;
    }

    return res.json({
      ok: true,
      created,
      hot,
      warm,
      note:
        created > 0
          ? "Heuristic buyers seeded. Refresh lists to view."
          : "No obvious buyers found by heuristic seed; try supplier persona or discovery.",
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "internal error" });
  }
});

/* ----------------------- helpers ----------------------- */

function rootDomain(d: string) {
  // strip scheme, path, www, subdomains (naive but good enough here)
  const host = d.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  const h = host.startsWith("www.") ? host.slice(4) : host;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  // keep last two labels (handles most .com/.net/.org)
  return parts.slice(-2).join(".");
}

function toCompanyName(root: string) {
  const base = root.split(".")[0];
  return base.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Very small, safe heuristic seeds so the pipeline is end-to-end visible.
 * We DO NOT crawl here; the discovery/AI layers can be layered later.
 * This just ensures /find-buyers produces LeadRecords that appear in /leads.
 */
function seedBuyersFor(supplierDomain: string) {
  const s = supplierDomain.toLowerCase();

  // General 3PL / DC-heavy ops that are common packaging buyers
  const BASE: Seed[] = [
    seed("ShipBob", "shipbob.com", "3PL / e-commerce fulfillment", 0.78),
    seed("XPO", "xpo.com", "LTL / logistics with DC network", 0.76),
    seed("GEODIS", "geodis.com", "Global logistics & distribution", 0.75),
    seed("Ryder", "ryder.com", "Warehousing / dedicated fleets", 0.74),
  ];

  // If supplier looks like packaging/flex/films/etc., add a couple extra targets
  if (/(pack|wrap|film|flex|shrink|stretch)/.test(s)) {
    BASE.push(seed("Kuehne+Nagel", "kuehne-nagel.com", "Global contract logistics (DC)", 0.78));
    BASE.push(seed("Lineage Logistics", "lineagelogistics.com", "Cold chain DCs (packaging demand)", 0.77));
  }

  // If supplier hints at corrugated/boxes/cartons
  if (/(corrug|box|carton)/.test(s)) {
    BASE.push(seed("Amazon Fulfillment", "amazon.com", "High-volume carton consumption", 0.80));
    BASE.push(seed("Walmart Distribution", "walmart.com", "Retail DCs / packaging consumers", 0.79));
  }

  // Return unique by domain, capped to 6 to keep UI tidy
  const uniq = new Map(BASE.map((x) => [x.domain, x]));
  return Array.from(uniq.values()).slice(0, 6);
}

type Seed = {
  company: string;
  domain: string;
  verticals: string[];
  signals: Record<string, number>;
  scores: Record<string, number>;
  reason: string;
};

function seed(company: string, domain: string, reason: string, intent = 0.75): Seed {
  return {
    company,
    domain,
    verticals: ["3pl", "distribution", "dc"],
    signals: { dc_density: 0.8, ops_hiring: 0.6 },
    scores: { intent, fit: 0.7, timing: 0.6, trust: 0.7 },
    reason,
  };
}

/* -------------------- exports -------------------- */
// Default export for `import buyers from "./routes/buyers"`
export default router;
// Named export for `import { buyersRouter } from "./routes/buyers"`
export const buyersRouter = router;
// Also attach a `default` property so weird namespace imports still work at runtime.
(Object.assign as any)(router, { default: router });
