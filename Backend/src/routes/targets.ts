// Backend/src/routes/targets.ts
import { Router, Request, Response } from "express";
import { requireApiKey } from "../auth";

/**
 * Minimal buyer discovery (MVP, no external APIs).
 * - Accepts a supplier domain and optional "extensions" (seed buyers, personas, regions, industries, keywords).
 * - Synthesizes a few buyer candidates.
 * - Inserts them by POSTing to our existing /api/v1/leads/ingest endpoint (reuses your current pipeline & scoring).
 * - Keeps builds green: no new deps; uses Node 20's global fetch.
 */

export const targetsRouter = Router();

/** POST /api/v1/targets/discover  (header x-api-key required) */
targetsRouter.post("/discover", requireApiKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const supplierDomain = pickDomain(body.domain, body.supplierDomain, body.host);
    if (!supplierDomain) {
      return res.status(400).json({ ok: false, error: "supplierDomain (or domain/host) is required" });
    }

    const opts = parseOptions(body);
    const candidates = synthesizeCandidates({ supplierDomain, ...opts });

    const base = process.env.SELF_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
    const token =
      (req.get("x-api-key") || "") ||
      process.env.APIKey ||
      process.env.API_KEY ||
      process.env.AdminKey ||
      process.env.AdminToken ||
      "";

    const inserted: Array<number | string> = [];
    for (const c of candidates) {
      try {
        const r = await fetch(`${base}/api/v1/leads/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": String(token || ""),
          },
          body: JSON.stringify(c),
        });
        const j: any = await r.json().catch(() => null);
        if (j?.ok && (j.id ?? j.leadId)) inserted.push(j.id ?? j.leadId);
      } catch {
        // Ignore per-candidate failures to keep the whole request resilient
      }
    }

    return res.json({
      ok: true,
      supplierDomain,
      created: inserted.length,
      ids: inserted,
      candidates, // echoed for transparency
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "unexpected_error" });
  }
});

/**
 * (Convenience) GET /api/v1/targets/discover?domain=...&api_key=...
 * Lets you test from a browser without setting headers.
 * Uses the same logic but authorizes via query param.
 */
targetsRouter.get("/discover", async (req: Request, res: Response) => {
  const expected =
    process.env.APIKey || process.env.API_KEY || process.env.AdminKey || process.env.AdminToken || "";
  const provided = (req.query.api_key as string) || "";
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const supplierDomain = pickDomain(req.query.domain, req.query.supplierDomain, req.query.host);
  if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain (domain) is required" });

  const opts = parseOptions(req.query);
  const candidates = synthesizeCandidates({ supplierDomain, ...opts });

  const base = process.env.SELF_BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
  const token = provided;

  const inserted: Array<number | string> = [];
  for (const c of candidates) {
    try {
      const r = await fetch(`${base}/api/v1/leads/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": token,
        },
        body: JSON.stringify(c),
      });
      const j: any = await r.json().catch(() => null);
      if (j?.ok && (j.id ?? j.leadId)) inserted.push(j.id ?? j.leadId);
    } catch {
      // ignore
    }
  }

  return res.json({ ok: true, supplierDomain, created: inserted.length, ids: inserted, candidates });
});

/* ---------- helpers ---------- */

function pickDomain(...vals: unknown[]): string {
  const v = vals.find(Boolean);
  if (!v) return "";
  return String(v).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function normalizeList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map(sane).filter(Boolean);
  return String(v)
    .split(/[,\n]/)
    .map(sane)
    .filter(Boolean);
}

function sane(s: string) {
  return s.trim();
}

type Opts = {
  seedBuyers: string[];
  personas: string[];
  regions: string[];
  industries: string[];
  keywords: string[];
  platform?: string;
};

function parseOptions(src: any): Opts {
  return {
    seedBuyers: normalizeList(src.seedBuyers || src.seeds),
    personas: normalizeList(src.personas),
    regions: normalizeList(src.regions),
    industries: normalizeList(src.industries),
    keywords: normalizeList(src.keywords || src.kw),
    platform: src.platform ? String(src.platform) : undefined,
  };
}

type SynthOpts = { supplierDomain: string } & Opts;

function synthesizeCandidates(o: SynthOpts) {
  // Basic heuristic seeds; if caller provides seedBuyers, we prioritize those.
  const defaultSeeds = ["brand-a.com", "brand-b.com", "brand-x.com", "store-b.com", "warehouseco.com", "fulfillment-pro.com"];
  const seeds = o.seedBuyers.length ? o.seedBuyers : defaultSeeds;

  // If keywords include RFP/RFQ/tender/bid → mark "hot", else "warm".
  const wantRFP = o.keywords.some((k) => /rfp|rfq|tender|bid/i.test(k));
  const packKw = o.keywords.length ? o.keywords : ["packaging", "boxes", "labels", "mailers", "stretch wrap"];

  const items = [];
  for (let i = 0; i < Math.min(5, seeds.length); i++) {
    const host = pickDomain(seeds[i]);

    // Avoid echoing the supplier itself
    if (!host || host === o.supplierDomain) continue;

    const title = wantRFP ? `RFP: ${packKw[0]}` : `Lead: ${host}`;
    const temperature = wantRFP ? "hot" : "warm";

    const why = [
      { label: "Domain quality", kind: "meta", score: host.endsWith(".com") ? 0.65 : 0.55, detail: `${host} (.${host.split(".").pop()})` },
      { label: "Platform fit", kind: "platform", score: o.platform ? 0.7 : 0.5, detail: o.platform || "unknown" },
      { label: "Intent keywords", kind: "signal", score: wantRFP ? 0.9 : 0.6, detail: wantRFP ? `rfp, ${packKw[0]}` : packKw.slice(0, 2).join(", ") },
    ];

    items.push({
      // This shape matches your /leads/ingest expectations
      cat: "product",
      platform: o.platform || "unknown",
      host,
      title,
      keywords: packKw.join(", "),
      temperature,
      why,
    });
  }

  return items;
}
