
// src/routes/buyers.ts
import type { Request, Response } from "express";
import { Router } from "express";
import {
  MemoryBleedStore,
  type LeadRecord,
  type LeadStatus,
} from "../data/bleed-store";

// ---- stable, process-wide store (survives module reloads in dev)
const g = globalThis as any;
const store: MemoryBleedStore =
  g.__BLEED_STORE__ || (g.__BLEED_STORE__ = new MemoryBleedStore());

// simple tenant inference (use your auth later)
function tenantIdFrom(req: Request) {
  const k = (req.headers["x-api-key"] || "").toString();
  return k ? t_${k.slice(0, 8)} : "t_public";
}

function normalizeDomain(input: string) {
  const s = (input || "").trim().toLowerCase();
  return s
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export default function mountBuyers(host: unknown) {
  const r = Router();

  /**
   * POST /api/v1/leads/find-buyers
   * Body: { domain?: string, supplier?: string, region?: string, radiusMi?: number, persona?: {...} }
   *
   * Returns: { ok, created, hot, warm }
   */
  r.post("/leads/find-buyers", async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, any>;
      const domain = normalizeDomain(String(body.domain  body.supplier  ""));
      const region = String(body.region || "usca").toLowerCase();
      const radiusMi = Number.isFinite(body.radiusMi) ? Number(body.radiusMi) : 50;

      if (!domain) {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      const tenantId = tenantIdFrom(req);
      console.log(`[buyers] find-buyers tenant=${tenantId} domain=${domain} region=${region} r=${radiusMi}`);

      // --- Minimal “discovery”: seed one candidate + self (so the panel shows something)
      // In the next pass, swap this with your webscout + OpenRouter persona inference.
      const created: LeadRecord[] = [];

      // 1) self/company record (so “Details” shows the supplier immediately)
      const self = await store.upsertLead({
        tenantId,
        source: "supplier:self",
        company: domain.split(".")[0],
        domain,
        website: https://${domain},
        region,
        scores: { fit: 0.6, intent: 0.1, timing: 0.3, trust: 0.5 },
        status: "enriched",
      });
      created.push(self);

      // 2) a placeholder buyer candidate (replace with real candidates next)
      const buyer = await store.upsertLead({
        tenantId,
        source: "seed:placeholder",
        company: "Prospect @ " + domain,
        domain: ${domain}-prospect,
        website: https://${domain},
        region,
        scores: { fit: 0.55, intent: 0.25, timing: 0.35, trust: 0.4 },
        status: "qualified",
      });
      created.push(buyer);

      // optional decision trail / evidence could be appended here later

      const hot = created.filter((c) => (c.scores?.intent || 0) >= 0.7).length;
      const warm = created.length - hot;

      return res.status(200).json({ ok: true, created: created.length, hot, warm });
    } catch (err: any) {
      console.error("[buyers] error", err?.stack || err);
      return res.status(500).json({ ok: false, error: "internal" });
    }
  });

  /**
   * GET /api/v1/leads
   * Query: temp=hot|warm, region=us/ca/...
   * Returns the tenant’s current leads from the BLEED store.
   * This shadows the public stub so the panel actually shows rows.
   */
  r.get("/leads", async (req: Request, res: Response) => {
    const tenantId = tenantIdFrom(req);
    const temp = String(req.query.temp || "warm").toLowerCase(); // 'hot' or 'warm'
    const region = String(req.query.region || "").toLowerCase();

    let items = await store.listLeads(tenantId, { limit: 200 });

    if (region) {
      items = items.filter((l) => (l.region || "").toLowerCase() === region);
    }
    // naive temp split based on intent score
    items = items.filter((l) => {
      const intent = l.scores?.intent ?? 0;
      return temp === "hot" ? intent >= 0.7 : intent < 0.7;
    });

    console.

log(`[buyers] GET /leads -> 200 temp=${temp} region=${region || "-"} count=${items.length}`);
    res.status(200).json({ ok: true, items, count: items.length });
  });

  // --- Mount defensively (don’t crash if host isn’t an Express app)
  if (host && typeof (host as any).use === "function") {
    (host as any).use("/api/v1", r);
  } else {
    console.warn("[routes] buyers: host has no .use(); returning router (not mounted).");
  }
  return r;
}
