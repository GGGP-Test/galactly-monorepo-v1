import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { requireApiKey } from "../auth";

// ---------- Types ----------
type Temp = "hot" | "warm";
type WhyKind = "meta" | "platform" | "signal" | "activity" | "geo" | "persona";
type Why = { label: string; kind: WhyKind; score: number; detail: string };

type Lead = {
  id: string;
  host: string;
  platform: string; // "shopify" | "woocommerce" | "unknown"
  cat: string; // "product" etc.
  title: string;
  created_at: string; // ISO
  temperature: Temp;
  why: Why[];
  stage?: "new" | "qualified" | "contacted" | "won" | "lost";
  notes?: { ts: string; text: string }[];
};

type BuyerRequest = {
  supplier?: string; // supplier domain (required)
  region?: string; // "us" | "ca" | city/region hint (optional)
  radiusMi?: number; // radius miles (optional)
  keywords?: string; // optional, comma-separated, we can boost by it
};

// ---------- In-memory store (ephemeral) ----------
let NEXT_ID = 1;
const store = new Map<string, Lead>();
const hot: Lead[] = [];
const warm: Lead[] = [];

// ---------- Seed list (optional, best-effort) ----------
const SEED_FILE = "/etc/secrets/seeds.txt";
let SEEDS_RAW: string[] = [];
try {
  if (fs.existsSync(SEED_FILE)) {
    const raw = fs.readFileSync(SEED_FILE, "utf8");
    SEEDS_RAW = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
} catch {
  // ignore — runtime can work without seeds
}

// very light domain extractor (handles lines like "brand-x.com,https:" too)
const DOMAIN_RE =
  /([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|co|io|ai|ca|us|store|shop|biz|me)/i;

function pickDomain(input: string): string | null {
  const m = input.toLowerCase().match(DOMAIN_RE);
  return m ? m[0].replace(/^https?:\/\//, "") : null;
}

const NON_US_CA_HINTS =
  /(dubai|uae|saudi|uk\b|london|europe|eu\b|de\b|germany|france|italy|spain|aus|australia|nz\b|india|pakistan|mexico|brazil|singapore|hong ?kong|china|\.cn\b|japan|korea|turkey|thailand|vietnam|philippines|ph\b)/i;

function isUSorCA(line: string, domain: string): boolean {
  if (domain.endsWith(".ca")) return true;
  // if any clear non-US/CA hints exist in the seed row, drop it
  if (NON_US_CA_HINTS.test(line)) return false;
  // default accept .com/.us/.store/etc. as US unless hints say otherwise
  return true;
}

// quick packaging keyword detector to mark HOT
const PACKAGING_KWS =
  /(rfp|rfq|tender|bid|packaging|mailers?|poly mailers?|cartons?|boxes?|labels?|shrink|stretch|pallet|fulfillment|warehouse|3pl)/i;

// ---------- Helpers ----------
function nowISO(): string {
  return new Date().toISOString();
}

function makeLead(host: string, temperature: Temp, extraWhy: Why[] = []): Lead {
  const id = String(NEXT_ID++);
  const why: Why[] = [
    { label: "Domain quality", kind: "meta", score: host.endsWith(".com") ? 0.65 : 0.6, detail: `${host} (${host.split(".").pop()})` },
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

function seedsAsLeads(options: { supplier?: string; region?: string; radiusMi?: number; keywords?: string }) {
  const { supplier, region, keywords } = options;
  const keywordBoost = (keywords || "").toLowerCase();

  const supplierHost = supplier ? pickDomain(supplier) : null;

  const out: Lead[] = [];
  for (const row of SEEDS_RAW) {
    const domain = pickDomain(row);
    if (!domain) continue;

    // skip supplier's own domain
    if (supplierHost && domain === supplierHost) continue;

    // US/CA only
    if (!isUSorCA(row, domain)) continue;

    // temperature based on packaging keywords in the seed row or keywordBoost
    const rowLower = row.toLowerCase();
    const isHot = PACKAGING_KWS.test(rowLower) || (keywordBoost && rowLower.includes(keywordBoost));

    const activityWhy: Why[] = [];
    if (isHot) {
      activityWhy.push({ label: "Intent keywords", kind: "signal", score: 0.9, detail: (rowLower.match(PACKAGING_KWS)?.[0] || "packaging") });
    } else {
      activityWhy.push({ label: "Intent keywords", kind: "signal", score: 0.6, detail: "no strong keywords" });
    }

    // simple geo note: when region hint is provided by user, attach it as a reason
    if (region) {
      activityWhy.push({ label: "Near your region", kind: "geo", score: 0.7, detail: region });
    }

    const lead = makeLead(domain, isHot ? "hot" : "warm", activityWhy);
    out.push(lead);
  }
  return out;
}

// CSV helper
function toCSV(rows: Lead[]): string {
  const header = "id,host,platform,cat,title,created_at,temperature";
  const body = rows
    .map((l) =>
      [
        JSON.stringify(l.id),
        JSON.stringify(l.host),
        JSON.stringify(l.platform),
        JSON.stringify(l.cat),
        JSON.stringify(l.title),
        JSON.stringify(new Date(l.created_at).toString()),
        JSON.stringify(l.temperature),
      ].join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

// ---------- Router ----------
export default function mountLeads(): Router {
  const router = Router();

  // Simple docs
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
    res.json({
      ok: true,
      temperature: lead.temperature,
      lead,
      why: lead.why,
    });
  });

  // Stage + Notes (require key)
  router.patch("/api/v1/leads/:id/stage", requireApiKey, (req, res) => {
    const lead = store.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const s = String((req.body?.stage ?? "").toString().toLowerCase());
    if (!s || !["new", "qualified", "contacted", "won", "lost"].includes(s)) {
      return res.status(400).json({ ok: false, error: "bad stage" });
    }
    lead.stage = s as Lead["stage"];
    res.json({ ok: true, leadId: Number(lead.id), stage: lead.stage });
  });

  router.post("/api/v1/leads/:id/notes", requireApiKey, (req, res) => {
    const lead = store.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const text = String(req.body?.note ?? "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "note required" });
    lead.notes = lead.notes || [];
    lead.notes.push({ ts: nowISO(), text });
    res.json({ ok: true, leadId: Number(lead.id) });
  });

  // CSV export
  router.get("/api/v1/leads/export.csv", (req, res) => {
    const temp = String(req.query.temperature ?? "hot") as Temp;
    const lim = Math.max(0, Number(req.query.limit ?? 50));
    const rows = (temp === "warm" ? warm : hot).slice(0, lim || 50);
    const csv = toCSV(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  });

  // Back-compat single ingest (kept for the right-side form if used)
  router.post("/api/v1/leads/ingest", requireApiKey, (req, res) => {
    const host = pickDomain(String(req.body?.source_url ?? req.body?.host ?? ""));
    const cat = String(req.body?.cat ?? "product");
    const title = String(req.body?.title ?? ("Lead: " + (host || "unknown")));
    if (!host) return res.status(400).json({ ok: false, error: "host/source_url required" });

    const kw = String(req.body?.kw ?? "").toLowerCase();
    const isHot = PACKAGING_KWS.test(kw);

    const why: Why[] = [
      { label: "Intent keywords", kind: "signal", score: isHot ? 0.9 : 0.6, detail: kw || (isHot ? "packaging" : "no strong keywords") },
    ];

    const lead = makeLead(host, isHot ? "hot" : "warm", why);
    lead.cat = cat;
    lead.title = title;

    res.json({ ok: true, id: Number(lead.id) });
  });

  // --------- NEW: Buyer Finder (front-end "Find buyers") ----------
  function parseBuyerRequest(req: Request): BuyerRequest {
    const body = (req.body || {}) as any;
    const q = req.query || {};
    const supplier = String(body.supplier ?? q.supplier ?? "").trim() || String(body.domain ?? q.domain ?? "").trim();
    const region = String(body.region ?? q.region ?? "").trim().toLowerCase();
    const radiusMi = Number(body.radiusMi ?? q.radiusMi ?? 50) || 50;
    const keywords = String(body.keywords ?? q.keywords ?? "").trim();
    return { supplier, region, radiusMi, keywords };
  }

  function handleBuyerFind(req: Request, res: Response) {
    const { supplier, region, radiusMi, keywords } = parseBuyerRequest(req);
    if (!supplier) return res.status(400).json({ ok: false, error: "supplier (domain) required" });

    const createdBefore = NEXT_ID;
    const candidates = seedsAsLeads({ supplier, region, radiusMi, keywords });
    // basic dedupe: if we already have a lead with same host in memory, skip it
    const seenHosts = new Set<string>();
    const unique = candidates.filter((c) => {
      if (seenHosts.has(c.host)) return false;
      seenHosts.add(c.host);
      return true;
    });

    // Partition back into hot/warm arrays is already done in makeLead()
    const createdCount = NEXT_ID - createdBefore;

    res.json({
      ok: true,
      supplierDomain: pickDomain(supplier),
      created: createdCount,
      ids: unique.map((l) => Number(l.id)),
      candidates: unique.map((l) => ({
        cat: l.cat,
        platform: l.platform,
        host: l.host,
        title: l.title,
        keywords: (l.why.find((w) => w.kind === "signal")?.detail || ""),
        temperature: l.temperature,
        why: l.why,
      })),
      tip: "US/CA only filter is applied by default. Provide region to bias toward your city/state.",
    });
  }

  // Preferred endpoint
  router.post("/api/v1/leads/buyers", handleBuyerFind);
  // Alias to avoid 404 from older/free-panel code
  router.post("/api/v1/leads/find-buyers", handleBuyerFind);

  return router;
}
