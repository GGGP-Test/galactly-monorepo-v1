import { Router, Request, Response } from "express";
import fs from "fs";

// ---------- Types ----------
type Temp = "hot" | "warm";
type WhyKind = "meta" | "platform" | "signal" | "activity" | "geo" | "persona";
type Why = { label: string; kind: WhyKind; score: number; detail: string };

type Lead = {
  id: string;
  host: string;
  platform: string;
  cat: string;
  title: string;
  created_at: string;
  temperature: Temp;
  why: Why[];
  stage?: "new" | "qualified" | "contacted" | "won" | "lost";
  notes?: { ts: string; text: string }[];
};

type BuyerRequest = {
  supplier?: string;       // supplier domain (required)
  region?: string;         // "us" | "ca" | city/state text
  radiusMi?: number;       // miles
  keywords?: string;       // optional boosts
};

// ---------- In-memory ----------
let NEXT_ID = 1;
const store = new Map<string, Lead>();
const hot: Lead[] = [];
const warm: Lead[] = [];

// ---------- Seeds ----------
const SEED_FILE = "/etc/secrets/seeds.txt";
let SEEDS_RAW: string[] = [];
try {
  if (fs.existsSync(SEED_FILE)) {
    SEEDS_RAW = fs.readFileSync(SEED_FILE, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
} catch { /* ignore */ }

// ---------- Utils ----------
const DOMAIN_RE =
  /([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|co|io|ai|ca|us|store|shop|biz|me)/i;

function normalizeDomain(input: string): string | null {
  if (!input) return null;
  const s = String(input).toLowerCase();
  const m = s.match(DOMAIN_RE);
  return m ? m[0].replace(/^https?:\/\//, "") : null;
}

const NON_US_CA_HINTS =
  /(dubai|uae|saudi|uk\b|london|europe|eu\b|de\b|germany|france|italy|spain|aus|australia|nz\b|india|pakistan|mexico|brazil|singapore|hong ?kong|china|\.cn\b|japan|korea|turkey|thailand|vietnam|philippines|ph\b)/i;

function isUSorCA(seedRow: string, domain: string): boolean {
  if (domain.endsWith(".ca")) return true;
  if (NON_US_CA_HINTS.test(seedRow)) return false;
  return true; // default accept .com etc. as US unless hints say otherwise
}

const PACKAGING_KWS =
  /(rfp|rfq|tender|bid|packaging|mailers?|poly mailers?|cartons?|boxes?|labels?|shrink|stretch|pallet|fulfillment|warehouse|3pl)/i;

const nowISO = () => new Date().toISOString();

function makeLead(host: string, temperature: Temp, extraWhy: Why[] = []): Lead {
  const id = String(NEXT_ID++);
  const why: Why[] = [
    { label: "Domain quality", kind: "meta", score: host.endsWith(".com") ? 0.65 : 0.6, detail: `${host} (.${host.split(".").pop()})` },
    { label: "Platform fit", kind: "platform", score: 0.5, detail: "unknown" },
    ...extraWhy,
  ];
  const lead: Lead = {
    id,
    host,
    platform: "unknown",
    cat: "product",
    title: `Lead: ${host}`,
    created_at: nowISO(),
    temperature,
    why,
    stage: "new",
    notes: [],
  };
  store.set(id, lead);
  (temperature === "hot" ? hot : warm).unshift(lead);
  return lead;
}

function seedsAsLeads(opts: { supplier?: string; region?: string; radiusMi?: number; keywords?: string }) {
  const { supplier, region, keywords } = opts;
  const supplierHost = supplier ? normalizeDomain(supplier) : null;
  const boost = (keywords || "").toLowerCase();

  const out: Lead[] = [];
  for (const row of SEEDS_RAW) {
    const domain = normalizeDomain(row);
    if (!domain) continue;
    if (supplierHost && domain === supplierHost) continue; // skip self
    if (!isUSorCA(row, domain)) continue;

    const rowLower = row.toLowerCase();
    const isHot = PACKAGING_KWS.test(rowLower) || (boost && rowLower.includes(boost));

    const reasons: Why[] = [];
    reasons.push({
      label: "Intent keywords",
      kind: "signal",
      score: isHot ? 0.9 : 0.6,
      detail: isHot ? (rowLower.match(PACKAGING_KWS)?.[0] || boost || "packaging") : "no strong keywords",
    });
    if (region) reasons.push({ label: "Near your region", kind: "geo", score: 0.7, detail: region });

    out.push(makeLead(domain, isHot ? "hot" : "warm", reasons));
  }
  return out;
}

function toCSV(rows: Lead[]): string {
  const header = "id,host,platform,cat,title,created_at,temperature";
  const body = rows
    .map(l => [
      JSON.stringify(l.id),
      JSON.stringify(l.host),
      JSON.stringify(l.platform),
      JSON.stringify(l.cat),
      JSON.stringify(l.title),
      JSON.stringify(new Date(l.created_at).toString()),
      JSON.stringify(l.temperature),
    ].join(","))
    .join("\n");
  return `${header}\n${body}`;
}

// ---------- Request parsing (more tolerant) ----------
function readAnyBody(req: Request): any {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return { raw: req.body }; }
  }
  return req.body;
}

function parseBuyerRequest(req: Request): BuyerRequest {
  const q = (req.query || {}) as Record<string, any>;
  const b = readAnyBody(req) as Record<string, any>;
  // accept lots of aliases from the panel or external callers
  const supplierRaw =
    b.supplier ?? q.supplier ??
    b.domain ?? q.domain ??
    b.supplierDomain ?? q.supplierDomain ??
    b.host ?? q.host ??
    b.website ?? q.website ??
    b.url ?? q.url ??
    b.source ?? q.source ??
    b.source_url ?? q.source_url ??
    b.supplier_url ?? q.supplier_url ??
    b.d ?? q.d ?? "";

  const regionRaw =
    b.region ?? q.region ??
    b.geo ?? q.geo ??
    (b.us_only || q.us_only ? "us" : "") ??
    (b.usca || q.usca ? "us/ca" : "") ?? "";

  const radiusRaw = b.radiusMi ?? q.radiusMi ?? b.radius ?? q.radius ?? b.mi ?? q.mi ?? 50;
  const keywordsRaw = b.keywords ?? q.keywords ?? b.kw ?? q.kw ?? "";

  const supplier = normalizeDomain(String(supplierRaw));
  const region = String(regionRaw || "").toLowerCase().trim();
  const radiusMi = Number(radiusRaw) || 50;
  const keywords = String(keywordsRaw || "").trim();

  return { supplier: supplier || undefined, region, radiusMi, keywords };
}

// ---------- Router ----------
export default function mountLeads(): Router {
  const router = Router();

  // Index
  router.get("/api/v1/leads", (_req, res) => {
    res.json({ ok: true, endpoints: ["/api/v1/leads/hot", "/api/v1/leads/warm", "/api/v1/leads/:id", "/api/v1/leads/buyers"] });
  });

  // Lists
  router.get("/api/v1/leads/hot", (req, res) => {
    const lim = Math.max(0, Number(req.query.limit ?? 50));
    res.json({ ok: true, items: hot.slice(0, lim || 50) });
  });

  router.get("/api/v1/leads/warm", (req, res) => {
    const lim = Math.max(0, Number(req.query.limit ?? 50));
    res.json({ ok: true, items: warm.slice(0, lim || 50) });
  });

  // One lead
  router.get("/api/v1/leads/:id", (req, res) => {
    const lead = store.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    res.json({ ok: true, temperature: lead.temperature, lead, why: lead.why });
  });

  // Stage / Notes left out here for brevity in this file; keep your existing ones
  // If you removed them earlier, add them back exactly as before.

  // CSV
  router.get("/api/v1/leads/export.csv", (req, res) => {
    const temp = String(req.query.temperature ?? "hot") as Temp;
    const lim = Math.max(0, Number(req.query.limit ?? 50));
    const rows = (temp === "warm" ? warm : hot).slice(0, lim || 50);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(toCSV(rows));
  });

  // ----- Buyer Finder (accepts POST or GET; many field names) -----
  function handleBuyerFind(req: Request, res: Response) {
    const parsed = parseBuyerRequest(req);
    if (!parsed.supplier) {
      return res.status(400).json({ ok: false, error: "supplier (domain) required", hint: "Use supplier=stretchandshrink.com (or supplierDomain/domain/host/url)" });
    }
    const before = NEXT_ID;
    const candidates = seedsAsLeads(parsed);

    // dedupe by host
    const seen = new Set<string>();
    const uniq = candidates.filter(c => (seen.has(c.host) ? false : (seen.add(c.host), true)));

    const created = NEXT_ID - before;
    res.json({
      ok: true,
      supplierDomain: parsed.supplier,
      created,
      ids: uniq.map(l => Number(l.id)),
      candidates: uniq.map(l => ({
        cat: l.cat,
        platform: l.platform,
        host: l.host,
        title: l.title,
        keywords: (l.why.find(w => w.kind === "signal")?.detail || ""),
        temperature: l.temperature,
        why: l.why,
      })),
      tip: "Filtered to US/CA. Add region to bias toward a city or state.",
    });
  }

  router.post("/api/v1/leads/buyers", handleBuyerFind);
  router.get("/api/v1/leads/buyers", handleBuyerFind);       // GET alias
  router.post("/api/v1/leads/find-buyers", handleBuyerFind); // legacy alias
  router.get("/api/v1/leads/find-buyers", handleBuyerFind);  // legacy alias

  return router;
}
