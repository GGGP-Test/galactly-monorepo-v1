// Backend/src/routes/targets.ts
import { Router, Request, Response } from "express";
import { requireApiKey } from "../auth";
import fs from "fs";
import path from "path";

/**
 * /api/v1/targets/discover
 * Input: supplier domain (required) + optional extensions: seedBuyers, personas, regions, industries, keywords, platform.
 * Output: creates buyer-candidate leads by reusing /api/v1/leads/ingest and returns ids.
 *
 * MVP notes:
 * - Reads curated seeds from /etc/secrets/seeds.txt (one domain per line). Also supports SEED_BUYERS env, comma-separated.
 * - No external services; safe, deterministic, and keeps builds green.
 * - Uses request host/protocol to call this service's own /leads/ingest (fixes the "created: 0" you saw).
 */

export const targetsRouter = Router();

targetsRouter.post("/discover", requireApiKey, async (req: Request, res: Response) => {
  try {
    const supplierDomain = pickDomain(req.body?.domain ?? req.body?.supplierDomain ?? req.body?.host);
    if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain (domain/host) is required" });

    const opts = parseOptions(req.body);
    const seeds = loadSeeds(opts.seedBuyers);
    const candidates = synthesizeCandidates({ supplierDomain, ...opts, seeds });

    const base = inferBase(req);
    const token = req.get("x-api-key") || "";

    const { ids, created } = await insertCandidates(base, token, candidates);
    return res.json({ ok: true, supplierDomain, created, ids, candidates });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "unexpected_error" });
  }
});

// Convenience GET for quick browser testing: /api/v1/targets/discover?domain=...&api_key=...
targetsRouter.get("/discover", async (req: Request, res: Response) => {
  const expected =
    process.env.APIKey || process.env.API_KEY || process.env.AdminKey || process.env.AdminToken || "";
  const provided = String(req.query.api_key || "");
  if (!expected || provided !== expected) return res.status(401).json({ ok: false, error: "unauthorized" });

  const supplierDomain = pickDomain(req.query.domain || req.query.supplierDomain || req.query.host);
  if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain (domain) is required" });

  const opts = parseOptions(req.query);
  const seeds = loadSeeds(opts.seedBuyers);
  const candidates = synthesizeCandidates({ supplierDomain, ...opts, seeds });

  const base = inferBase(req);
  const { ids, created } = await insertCandidates(base, provided, candidates);
  return res.json({ ok: true, supplierDomain, created, ids, candidates });
});

/* ----------------- helpers ----------------- */

function inferBase(req: Request): string {
  // Prefer explicit env if present, else derive from request (fix for "created:0")
  const envBase = process.env.SELF_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host") || "127.0.0.1:8787";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function pickDomain(v: any): string {
  if (!v) return "";
  return String(v).toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function normalizeList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
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

function loadSeeds(override: string[]): string[] {
  // Priority: explicit in request → /etc/secrets/seeds.txt → SEED_BUYERS env → minimal defaults
  if (override?.length) return uniqDomains(override);

  const paths = ["/etc/secrets/seeds.txt", "/etc/secrets/seeds"];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, "utf8");
        const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        if (lines.length) return uniqDomains(lines);
      }
    } catch {}
  }

  const envSeeds = normalizeList(process.env.SEED_BUYERS);
  if (envSeeds.length) return uniqDomains(envSeeds);

  return uniqDomains(["brand-a.com", "brand-b.com", "brand-x.com", "store-b.com", "warehouseco.com", "fulfillment-pro.com"]);
}

function uniqDomains(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const d = pickDomain(raw);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

type SynthOpts = Opts & { supplierDomain: string; seeds: string[] };

function synthesizeCandidates(o: SynthOpts) {
  const wantRFP = o.keywords.some((k) => /rfp|rfq|tender|bid/i.test(k));
  const packKw = o.keywords.length ? o.keywords : ["packaging", "boxes", "labels", "mailers", "stretch wrap"];
  const items = [];

  for (const hostRaw of o.seeds.slice(0, 8)) {
    const host = pickDomain(hostRaw);
    if (!host || host === o.supplierDomain) continue;

    const temperature = wantRFP ? "hot" : "warm";
    const title = wantRFP ? `RFP: ${packKw[0]}` : `Lead: ${host}`;
    const why = [
      { label: "Domain quality", kind: "meta", score: /\.com$/i.test(host) ? 0.65 : 0.55, detail: `${host} (.${host.split(".").pop()})` },
      { label: "Platform fit", kind: "platform", score: o.platform ? 0.7 : 0.5, detail: o.platform || "unknown" },
      { label: "Intent keywords", kind: "signal", score: wantRFP ? 0.9 : 0.6, detail: wantRFP ? `rfp, ${packKw[0]}` : packKw.slice(0, 2).join(", ") },
    ];

    items.push({
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

async function insertCandidates(base: string, token: string, candidates: any[]) {
  const ids: Array<number | string> = [];
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
      if (j?.ok && (j.id ?? j.leadId)) ids.push(j.id ?? j.leadId);
    } catch {
      // ignore per-candidate error
    }
  }
  return { ids, created: ids.length };
}
