import { Router } from "express";

// Tiny in-memory store (compatible enough with what public.js expects)
class MemoryStore {
  constructor() {
    this.leads = new Map(); // key: leadId
  }
  _id() {
    return ${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)};
  }
  async upsertLead(lead) {
    // de-dupe by domain per tenant
    const key = [...this.leads.keys()].find((k) => {
      const l = this.leads.get(k);
      return l.tenantId === lead.tenantId && l.domain && lead.domain && l.domain === lead.domain;
    });
    const now = Date.now();
    if (key) {
      const prev = this.leads.get(key);
      const merged = {
        ...prev,
        ...lead,
        scores: { ...(prev.scores  {}), ...(lead.scores  {}) },
        signals: { ...(prev.signals  {}), ...(lead.signals  {}) },
        updatedAt: now,
      };
      this.leads.set(key, merged);
      return merged;
    }
    const rec = {
      id: this._id(),
      tenantId: lead.tenantId,
      source: lead.source || "seed",
      company: lead.company,
      domain: lead.domain,
      website: lead.website || (lead.domain ? https://${lead.domain} : undefined),
      country: lead.country || "US",
      region: lead.region || "usca",
      verticals: lead.verticals || [],
      signals: lead.signals || {},
      scores: lead.scores || {},
      contacts: lead.contacts || [],
      status: lead.status || "enriched",
      createdAt: now,
      updatedAt: now,
    };
    this.leads.set(rec.id, rec);
    return rec;
  }
  async listLeads(tenantId, { limit = 200 } = {}) {
    const rows = [...this.leads.values()].filter((l) => l.tenantId === tenantId);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows.slice(0, limit);
  }
}

function ensureStore() {
  const g = globalThis;
  if (!g.__BLEED_STORE__) {
    g.__BLEED_STORE__ = new MemoryStore();
    console.log("[store] initialized in-memory BLEED store");
  }
  return g.__BLEED_STORE__;
}

export default function mountBuyers(app) {
  const r = Router();

  // share the same permissive CORS contract
  r.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  // POST /api/v1/leads/find-buyers
  r.post("/leads/find-buyers", async (req, res) => {
    try {
      const apiKey = String(req.headers["x-api-key"] || "");
      const tenantId = apiKey ? t_${apiKey.slice(0, 8)} : "t_public";
      const { domain, region } = req.body || {};
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      const store = ensureStore();

      // --- Seed a couple of plausible buyers so /leads shows something ---
      const buyers = [
        {
          company: "Peak 3PL – San Diego",
          domain: "peak3pl.example",
          region: (region || "usca").toLowerCase(),
          signals: { warehouses: 4, ecommerce_mix: 0.7, "op:multi-node": 1 },
          scores: { intent: 0.82, fit: 0.78, timing: 0.6 },
        },
        {
          company: "Swift Distribution",
          domain: "swiftdistro.example",
          region: (region || "usca").toLowerCase(),
          signals: { warehouses: 2, high_returns: 1, fragile_rate: 0.4 },
          scores: { intent: 0.66, fit: 0.72, timing: 0.55 },
        },
      ];

      let created = 0;
      for (const b of buyers) {
        await store.upsertLead({
          tenantId,
          source: "buyers:seed",
          ...b,
        });
        created++;
      }

      console.log(`[buyers] find-buyers ok domain=${domain} created=${created}`);
      res.status(200).json({ ok: true, created });
    } catch (err) {
      console.error("[buyers] /leads/find-buyers error", err);
      res.status(500).json({ ok: false, error: "internal" });
    }
  });

  app.use("/api/v1", r);
  console.log("[routes] mounted buyers from ./routes/buyers");
  return r;
}
