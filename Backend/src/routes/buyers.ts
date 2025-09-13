import { Router, Request, Response } from "express";

// Light, no-dependency domain normalization
function normalizeDomain(input: string): string {
  try {
    const raw = input.trim().toLowerCase();
    if (!raw) return "";
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  } catch {
    return "";
  }
}

// Try to attach to your real BLEED store if it exists.
// If not, we fall back to a tiny in-memory stub so the route still works.
type BleedStore = {
  upsertLead: (lead: Partial<any> & { tenantId: string }) => Promise<any>;
  listLeads: (tenantId: string, opts?: any) => Promise<any[]>;
};

let store: BleedStore | undefined = (globalThis as any).__BLEED_STORE;
if (!store) {
  // Lazy-load if your project already has the file; otherwise make a stub.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../data/bleed-store");
    const MemoryBleedStore = mod.MemoryBleedStore || mod.default?.MemoryBleedStore;
    if (MemoryBleedStore) {
      store = new MemoryBleedStore();
      (globalThis as any).__BLEED_STORE = store;
      console.log("[buyers] using MemoryBleedStore");
    }
  } catch {
    // tiny in-memory shim
    const leads: any[] = [];
    store = {
      async upsertLead(lead) {
        const id = lead.id || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const rec = {
          id,
          source: lead.source || "system",
          status: lead.status || "new",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...lead,
        };
        const idx = leads.findIndex((x) => x.id === rec.id);
        if (idx >= 0) leads[idx] = rec; else leads.push(rec);
        return rec;
      },
      async listLeads(tenantId: string) {
        return leads.filter((l) => l.tenantId === tenantId).sort((a, b) => b.updatedAt - a.updatedAt);
      },
    };
    (globalThis as any).__BLEED_STORE = store;
    console.log("[buyers] using in-memory shim store");
  }
}

const router = Router();

/**
 * POST /api/v1/leads/find-buyers
 * body: { domain: string, region?: string, radiusMi?: number, persona?: {...} }
 * returns: { ok, created, hot, warm, message }
 */
router.post("/find-buyers", async (req: Request, res: Response) => {
  try {
    const apiKey = (req.headers["x-api-key"] as string) || "";
    if (!apiKey) return res.status(401).json({ ok: false, error: "missing api key" });

    // simple tenant mapping (adjust to your auth)
    const tenantId = "t_demo";

    const domainRaw = (req.body?.domain ?? "") as string;
    const domain = normalizeDomain(domainRaw);
    if (!domain) return res.status(400).json({ ok: false, error: "domain is required" });

    const region = String(req.body?.region || "us/ca");
    const radiusMi = Number(req.body?.radiusMi || 50);

    // For now we create **one** candidate synthesized from the supplier domain.
    // This guarantees you see *something* appear in the panel while we wire real discovery.
    // Replace this block with your discovery engine when ready.
    const companyName = domain.split(".")[0].replace(/[-_]/g, " ");
    const candidate = await store!.upsertLead({
      tenantId,
      source: "seed:supplier",
      company: companyName.charAt(0).toUpperCase() + companyName.slice(1),
      domain,
      website: `https://${domain}`,
      region,
      signals: { seed_from_supplier: 1, near_radius_mi: radiusMi },
      scores: { intent: 0.1, fit: 0.2, timing: 0.1, trust: 0.5 },
      status: "enriched",
    });

    console.log(`[buyers] created seed candidate id=${candidate.id} domain=${domain}`);

    // Report something the panel understands
    res.status(200).json({
      ok: true,
      created: 1,
      hot: 0,
      warm: 1,
      message: "Seeded 1 candidate from supplier domain (placeholder).",
    });
  } catch (err: any) {
    console.error("[buyers] /find-buyers error:", err?.stack || err?.message || err);
    res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;