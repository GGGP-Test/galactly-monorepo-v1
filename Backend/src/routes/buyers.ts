// src/routes/buyers.ts
import type { Request, Response } from "express";
import { Router } from "express";

const router = Router();

// ---- tiny helpers ----------------------------------------------------------

function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  // strip path/query if user pasted a full URL
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  // very lenient domain check; server-side hardening can be added later
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

function ok(res: Response, body: Record<string, unknown>) {
  return res.status(200).json(body);
}
function bad(res: Response, msg: string) {
  return res.status(400).json({ ok: false, error: msg });
}

// Optional: BLEED store shim so we can run even if nothing injected in app
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
}

const memoryStore = (() => {
  const leads = new Map<string, LeadRecord>();
  const id = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const now = () => Date.now();
  const obj: BleedStore = {
    async upsertLead(l) {
      // naive merge by tenant+domain
      const existing = [...leads.values()].find(
        (x) => x.tenantId === l.tenantId && x.domain && l.domain && x.domain === l.domain,
      );
      if (existing) {
        const merged: LeadRecord = {
          ...existing,
          ...l,
          id: existing.id,
          updatedAt: now(),
        };
        leads.set(merged.id, merged);
        return merged;
      }
      const rec: LeadRecord = {
        id: id(),
        tenantId: l.tenantId,
        source: l.source ?? "buyers.find",
        company: l.company,
        domain: l.domain,
        website: l.website,
        country: l.country,
        region: l.region,
        verticals: l.verticals ?? [],
        signals: l.signals ?? {},
        scores: l.scores ?? {},
        contacts: l.contacts ?? [],
        status: l.status ?? "new",
        createdAt: now(),
        updatedAt: now(),
        meta: l.meta ?? {},
      };
      leads.set(rec.id, rec);
      return rec;
    },
  };
  return obj;
})();

function getStore(req: Request): BleedStore {
  // If index.ts attached a store: app.set('bleedStore', store)
  const injected = req.app.get("bleedStore");
  if (injected) return injected as BleedStore;
  if (!req.app.get("__buyers_store_warned")) {
    console.log("[buyers] using in-memory shim store");
    req.app.set("__buyers_store_warned", true);
  }
  return memoryStore;
}

// ---- route -----------------------------------------------------------------

/**
 * POST /api/v1/leads/find-buyers
 * body: { domain: string; region?: string; radiusMi?: number; persona?: object }
 * Also accepts supplierDomain|host|website for robustness.
 */
router.post("/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // tolerate various client keys, then normalize
    const domRaw =
      body.domain ?? body.supplierDomain ?? body.host ?? body.website ?? body.hostname ?? body.url ?? null;
    const domain = normalizeDomain(domRaw);

    if (!domain) {
      return bad(res, "domain is required");
    }

    const region = typeof body.region === "string" && body.region.trim() ? (body.region as string) : "US/CA";
    const radiusMi =
      typeof body.radiusMi === "number"
        ? (body.radiusMi as number)
        : Number.parseInt(String(body.radiusMi ?? "50"), 10) || 50;

    // Optionally persist a seed record for the supplier itself so the UI has a context row
    const store = getStore(req);
    const tenantId = (req as any).tenantId ?? "t_demo";
    await store.upsertLead({
      tenantId,
      source: "supplier",
      company: domain.split(".")[0],
      domain,
      website: `https://${domain}`,
      region,
      meta: { radiusMi },
    });

    // At this stage we only return a summary; the candidate discovery runs async (or is no-op stub)
    return ok(res, {
      ok: true,
      created: 0,
      hot: 0,
      warm: 0,
      info: `accepted domain=${domain} region=${region} radiusMi=${radiusMi}`,
    });
  } catch (err: any) {
    console.error("[buyers] find-buyers failed:", err?.stack || err);
    return res.status(500).json({ ok: false, error: "internal" });
  }
});

export default router;