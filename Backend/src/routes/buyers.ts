// src/routes/buyers.ts
import type { Express, Request, Response } from "express";
import {
  MemoryBleedStore,
  FileBleedStore,
  type LeadRecord,
  type BleedStore,
} from "../data/bleed-store";

// ---- store: persistent if path provided, otherwise in-memory ----
const BLEED_PATH = process.env.BLEED_FS_PATH || "";
const store: BleedStore = BLEED_PATH
  ? new FileBleedStore(BLEED_PATH.replace(/\/$/, ""))
  : new MemoryBleedStore();

function log(...args: any[]) {
  console.log("[buyers]", ...args);
}

// ---- tiny helpers ----
function normDomain(s?: string) {
  if (!s) return "";
  const d = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // reject obvious non-domains
  return /\./.test(d) ? d : "";
}

function asUSCA(region?: string) {
  return (region || "usca").toLowerCase().replace(/[^a-z]/g, "") === "usca" ? "US/CA" : region || "US/CA";
}

async function checkEgress(): Promise<{ ok: boolean; why?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch("https://example.com", { method: "HEAD", signal: ctrl.signal });
    clearTimeout(t);
    return { ok: r.ok };
  } catch (e: any) {
    return { ok: false, why: String(e?.name || e || "egress_error") };
  }
}

// ---- minimal packaging-friendly seeds (never return zero) ----
type Seed = { company: string; domain: string; region?: string; verticals?: string[] };
const SEEDS: Seed[] = [
  { company: "ShipBob", domain: "shipbob.com", verticals: ["3pl", "fulfillment"] },
  { company: "ShipMonk", domain: "shipmonk.com", verticals: ["3pl", "fulfillment"] },
  { company: "Ryder Supply Chain", domain: "ryder.com", verticals: ["3pl", "warehouse"] },
  { company: "XPO Logistics", domain: "xpo.com", verticals: ["ltl", "3pl"] },
  { company: "GXO Logistics", domain: "gxo.com", verticals: ["3pl", "warehouse"] },
  { company: "DHL Supply Chain US", domain: "dhl.com", verticals: ["3pl", "global"] },
  { company: "UPS Supply Chain Solutions", domain: "ups.com", verticals: ["3pl", "parcel"] },
  { company: "FedEx Supply Chain", domain: "fedex.com", verticals: ["3pl", "parcel"] },
  { company: "GEODIS", domain: "geodis.com", verticals: ["3pl"] },
  { company: "DB Schenker", domain: "dbschenker.com", verticals: ["3pl", "global"] },
  { company: "Kuehne+Nagel", domain: "kuehne-nagel.com", verticals: ["3pl", "global"] },
  { company: "Lineage Logistics", domain: "lineagelogistics.com", verticals: ["coldchain", "warehouse"] },
  { company: "Americold", domain: "americold.com", verticals: ["coldchain", "warehouse"] },
  { company: "Saddle Creek Logistics", domain: "sclogistics.com", verticals: ["3pl"] },
  { company: "Red Stag Fulfillment", domain: "redstagfulfillment.com", verticals: ["fulfillment"] },
  { company: "ShipHero", domain: "shiphero.com", verticals: ["fulfillment"] },
  { company: "Flexport", domain: "flexport.com", verticals: ["freight", "3pl"] },
  { company: "Rakuten Super Logistics", domain: "rakutensl.com", verticals: ["fulfillment"] },
  { company: "Whiplash (Ryder E-commerce)", domain: "gowhiplash.com", verticals: ["fulfillment"] },
  { company: "Quiet Platforms", domain: "quietplatforms.com", verticals: ["fulfillment"] },
];

// crude region gate (keep US/CA-friendly seeds)
function seedsForUSCA(max = 12): Seed[] {
  return SEEDS.slice(0, max);
}

// ---- candidate writer ----
async function writeCandidates(tenantId: string, supplierDomain: string, seeds: Seed[]) {
  let created = 0;
  for (const s of seeds) {
    const rec: Partial<LeadRecord> & { tenantId: string } = {
      tenantId,
      source: "seed:3pl",
      company: s.company,
      domain: s.domain,
      website: `https://${s.domain}`,
      region: "US/CA",
      verticals: s.verticals || [],
      signals: { seed_match: 1, for_supplier: supplierDomain },
      scores: { intent: 0.4, fit: 0.6 },
      status: "qualified",
    };
    await store.upsertLead(rec);
    created++;
  }
  return created;
}

// ---- HTTP handler ----
export default function mountBuyers(app: Express) {
  log("mounting /api/v1/leads/find-buyers");
  app.post("/api/v1/leads/find-buyers", expressJson, async (req: Request, res: Response) => {
    const started = Date.now();
    try {
      const tenantId = (req.headers["x-api-key"] as string) || "anon";
      const body = req.body || {};
      const supplier = normDomain(body.supplier || body.domain);
      const region = asUSCA(body.region);
      const radiusMi = Number(body.radiusMi || 50) || 50;
      const persona = body.persona || { offer: "", solves: "", titles: "" };

      if (!supplier) {
        log("reject: missing/invalid domain", { raw: body.supplier || body.domain });
        return res.status(400).json({ ok: false, error: "domain is required" });
      }

      log("request", { supplier, region, radiusMi, hasPersona: !!persona });

      // 1) quick egress check (never throw; only note)
      const eg = await checkEgress();
      if (!eg.ok) {
        log("egress blocked, falling back to seeds", eg.why || "");
      }

      let created = 0;
      let hot = 0;
      let warm = 0;
      let note = "";
      let candidates: string[] = [];

      if (eg.ok) {
        // --- inline discovery prototype (cheap & safe) ---
        // Try to fetch supplier homepage quickly to derive a couple of keywords.
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 3500);
          const r = await fetch(`https://${supplier}`, { signal: ctrl.signal });
          clearTimeout(t);
          if (r.ok) {
            const html = await r.text();
            const kw = (html.toLowerCase().match(/\b(3pl|fulfillment|warehouse|cold|e-?commerce|packag|distribution)\b/g) || []);
            const weight = kw.length;
            log("discovery: supplier keywords", { count: weight, sample: kw.slice(0, 5) });
            // If supplier looks ecom/3pl oriented, promote 3PL seeds to HOT
            const base = seedsForUSCA(12);
            created += await writeCandidates(tenantId, supplier, base);
            hot = Math.min(3, base.length);
            warm = Math.max(0, base.length - hot);
            candidates = base.map((s) => s.domain);
            note = weight > 0 ? "Heuristic: supplier site hints at 3PL/ecom; seeded 3PL candidates." : "No strong site hints; returned baseline 3PL seeds.";
          } else {
            note = `Supplier fetch not OK (${r.status}); returned baseline seeds.`;
            const base = seedsForUSCA(10);
            created += await writeCandidates(tenantId, supplier, base);
            warm = base.length;
            candidates = base.map((s) => s.domain);
          }
        } catch (e: any) {
          note = `Supplier fetch error; returned baseline seeds. (${e?.name || e})`;
          const base = seedsForUSCA(10);
          created += await writeCandidates(tenantId, supplier, base);
          warm = base.length;
          candidates = base.map((s) => s.domain);
        }
      } else {
        // egress blocked => always seed from local list
        const base = seedsForUSCA(10);
        created += await writeCandidates(tenantId, supplier, base);
        warm = base.length;
        candidates = base.map((s) => s.domain);
        note = "Egress blocked by host; served local seed catalog.";
      }

      const ms = Date.now() - started;
      log("done", { created, hot, warm, ms, note });

      return res.json({
        ok: true,
        supplier: { domain: supplier, region: region.toLowerCase().replace("/", ""), radiusMi },
        created,
        hot,
        warm,
        candidates,
        note,
        message:
          created > 0
            ? `Created ${created} candidate(s). Hot:${hot} Warm:${warm}.`
            : "Created 0 candidate(s). (Unexpected) — check logs.",
      });
    } catch (err: any) {
      log("fatal", err?.stack || String(err));
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}

// light json body parser without dragging full express import here
function expressJson(req: Request, res: Response, next: Function) {
  if (req.headers["content-type"] && String(req.headers["content-type"]).includes("application/json")) {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        req.body = buf ? JSON.parse(buf) : {};
        next();
      } catch {
        res.status(400).json({ ok: false, error: "invalid_json" });
      }
    });
  } else {
    req.body = {};
    next();
  }
}