// Backend/src/routes/targets.ts
import { Router, Request, Response } from "express";
import { requireApiKey } from "../auth";
import fs from "fs";

/**
 * POST /api/v1/targets/discover
 * GET  /api/v1/targets/discover?domain=...&api_key=...
 *
 * Input
 *  - domain / supplierDomain / host: supplier website or domain (required)
 *  - kw / keywords: optional comma-separated keywords (use "rfp" or "rfq" to mark candidates HOT)
 *  - platform / personas / regions / industries / seedBuyers: optional
 *
 * Behavior
 *  - Reads buyer seeds from /etc/secrets/seeds.txt (or env SEED_BUYERS). Robustly extracts domains from messy lines
 *    like "Brand X, https://brandx.com".
 *  - Synthesizes buyer candidates and inserts them via /api/v1/leads/ingest on this same service.
 *  - Returns created / skipped / errors + the candidate preview.
 */

export const targetsRouter = Router();

targetsRouter.post("/discover", requireApiKey, async (req, res) => {
  const supplierDomain = pickDomain(req.body?.domain ?? req.body?.supplierDomain ?? req.body?.host);
  if (!supplierDomain) return res.status(400).json({ ok: false, error: "supplierDomain (domain/host) is required" });

  const opts = parseOptions(req.body);
  const seeds = loadSeeds(opts.seedBuyers);
  const candidates = synthesizeCandidates({ supplierDomain, ...opts, seeds });

  const base = inferBase(req);
  const token = req.get("x-api-key") || "";

  const result = await insertCandidates(base, token, candidates);
  return res.json({ ok: true, supplierDomain, ...result, candidates });
});

targetsRouter.get("/discover", async (req, res) => {
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
  const result = await insertCandidates(base, provided, candidates);
  return res.json({ ok: true, supplierDomain, ...result, candidates });
});

/* ---------------- helpers ---------------- */

function inferBase(req: Request): string {
  // Use SELF_BASE_URL if set, else derive from request’s host/proto
  const envBase = process.env.SELF_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "127.0.0.1:8787";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function pickDomain(v: any): string {
  if (!v) return "";
  let s = String(v).toLowerCase();
  s = s.replace(/[()\[\]'"`]/g, " ");          // strip punctuation wrappers
  s = s.replace(/https?:\/\/|ftp:\/\/|www\./g, "");
  s = s.replace(/[,;|]/g, " ");                // splitters like ", https://"
  s = s.split(/\s+/).find(tok => tok.includes(".")) || "";
  s = s.replace(/\/.*$/, "");                  // drop path
  s = s.replace(/[^a-z0-9.-]/g, "");           // keep hostname chars
  return s;
}

function normalizeList(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  return String(v).split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
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
  if (override?.length) return uniqDomains(override);

  const files = ["/etc/secrets/seeds.txt", "/etc/secrets/seeds"];
  for (const f of files) {
    try {
      if (fs.existsSync(f)) {
        const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
        const out: string[] = [];
        for (const line of lines) {
          const d = pickDomain(line);
          if (d) out.push(d);
        }
        if (out.length) return uniqDomains(out);
      }
    } catch {}
  }

  const envSeeds = normalizeList(process.env.SEED_BUYERS);
  if (envSeeds.length) return uniqDomains(envSeeds);

  // Fallback demo (will be replaced by your secrets file)
  return uniqDomains([
    "brand-a.com",
    "brand-b.com",
    "brand-x.com",
    "wayfair.com",
    "laderachusa.com",
    "lovecorn.com",
  ]);
}

function uniqDomains(list: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const d = pickDomain(raw);
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
  }
  return out;
}

type SynthOpts = Opts & { supplierDomain: string; seeds: string[] };

function synthesizeCandidates(o: SynthOpts) {
  const wantRFP = o.keywords.some(k => /(^|\s)(rfp|rfq|tender|bid)(\s|,|$)/i.test(k));
  const packKw = o.keywords.length ? o.keywords : ["packaging", "boxes", "labels", "mailers", "stretch wrap"];
  const items: any[] = [];

  for (const host of o.seeds.slice(0, 12)) {
    if (!host || host === o.supplierDomain) continue;

    const temperature = wantRFP ? "hot" : "warm";
    const title = wantRFP ? `RFP: ${packKw[0]}` : `Lead: ${host}`;
    const why = [
      { label: "Domain quality", kind: "meta",     score: /\.com$/i.test(host) ? 0.65 : 0.55, detail: `${host} (.${host.split(".").pop()})` },
      { label: "Platform fit",  kind: "platform",  score: o.platform ? 0.7 : 0.5, detail: o.platform || "unknown" },
      { label: "Intent keywords", kind: "signal",  score: wantRFP ? 0.9 : 0.6, detail: wantRFP ? `rfp, ${packKw[0]}` : packKw.slice(0,2).join(", ") },
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
  const skipped: Array<{host:string;reason:string}> = [];
  const errors: Array<{host:string;reason:string}> = [];

  for (const c of candidates) {
    try {
      const r = await fetch(`${base}/api/v1/leads/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": token },
        body: JSON.stringify(c),
      });

      const text = await r.text();
      let j: any = null;
      try { j = JSON.parse(text); } catch {}

      const dup =
        r.status === 409 ||
        (j && (j.code === "duplicate" || /duplicate/i.test(j.error || j.message || "")));

      if (dup) { skipped.push({ host: c.host, reason: "duplicate" }); continue; }

      if (j?.ok && (j.id ?? j.leadId)) { ids.push(j.id ?? j.leadId); continue; }

      if (!j?.ok) { errors.push({ host: c.host, reason: j?.error || `status ${r.status}` }); }
    } catch (e: any) {
      errors.push({ host: c.host, reason: e?.message || "fetch_error" });
    }
  }

  return { created: ids.length, ids, skipped, errors };
}
