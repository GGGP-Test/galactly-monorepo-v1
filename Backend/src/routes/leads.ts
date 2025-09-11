import { Router, Request, Response } from "express";
import fs from "fs";

// ---------- Types ----------
type Temp = "hot" | "warm";
type Stage = "new" | "qualified" | "contacted" | "won" | "lost";
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
  stage?: Stage;
  notes?: { ts: string; text: string }[];
};

type BuyerRequest = {
  supplier?: string;   // supplier domain (required)
  region?: string;     // us|ca|city/state text
  radiusMi?: number;   // miles
  keywords?: string;   // optional boosts
};

// ---------- In-memory store ----------
let NEXT_ID = 1;
const byId = new Map<string, Lead>();
const hot: Lead[] = [];
const warm: Lead[] = [];

// ---------- Seeds (from /etc/secrets/seeds.txt) ----------
const SEED_FILE = "/etc/secrets/seeds.txt";
let SEEDS_RAW: string[] = [];
try {
  if (fs.existsSync(SEED_FILE)) {
    SEEDS_RAW = fs
      .readFileSync(SEED_FILE, "utf8")
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }
} catch {
  // ignore
}

// ---------- Helpers ----------
const DOMAIN_RE =
  /([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|co|io|ai|ca|us|store|shop|biz|me)/i;

function normalizeDomain(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const s = String(input).toLowerCase();
  const m = s.match(DOMAIN_RE);
  return m ? m[0].replace(/^https?:\/\//, "") : null;
}

// Safe coalesce without using ?? (avoids TS2881 under strict settings)
function firstDefined<T = any>(...vals: any[]): T | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v as T;
  }
  return undefined;
}

const NON_US_CA_HINTS =
  /(dubai|uae|saudi|uk\b|london|europe|eu\b|de\b|germany|france|italy|spain|aus|australia|nz\b|india|pakistan|mexico|brazil|singapore|hong ?kong|china|\.cn\b|japan|korea|turkey|thailand|vietnam|philippines|ph\b)/i;

function isUSorCA(seedRow: string, domain: string): boolean {
  if (domain.endsWith(".ca")) return true;
  if (NON_US_CA_HINTS.test(seedRow)) return false;
  return true; // default accept .com as US unless hints say otherwise
}

const PACKAGING_KWS =
  /(rfp|rfq|tender|bid|packaging|mailers?|poly mailers?|cartons?|boxes?|labels?|shrink|stretch|pallet|fulfillment|warehouse|3pl)/i;

const nowISO = () => new Date().toISOString();

function makeLead(host: string, temperature: Temp, extraWhy: Why[] = []): Lead {
  const id = String(NEXT_ID++);
  const why: Why[] = [
    {
      label: "Domain quality",
      kind: "meta",
      score: host.endsWith(".com") ? 0.65 : 0.6,
      detail: `${host} (.${host.split(".").pop()})`,
    },
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
  byId.set(id, lead);
  (temperature === "hot" ? hot : warm).unshift(lead);
  return lead;
}

function seedsAsLeads(opts: BuyerRequest) {
  const supplierHost = opts.supplier ? normalizeDomain(opts.supplier) : null;
  const boost = (opts.keywords || "").toLowerCase();
  const out: Lead[] = [];

  for (const row of SEEDS_RAW) {
    const domain = normalizeDomain(row);
    if (!domain) continue;
    if (supplierHost && domain === supplierHost) continue; // skip self
    if (!isUSorCA(row, domain)) continue;

    const rowLower = row.toLowerCase();
    const isHot = PACKAGING_KWS.test(rowLower) || (boost && rowLower.includes(boost));

    const reasons: Why[] = [
      {
        label: "Intent keywords",
        kind: "signal",
        score: isHot ? 0.9 : 0.6,
        detail: isHot ? (rowLower.match(PACKAGING_KWS)?.[0] || boost || "packaging") : "no strong keywords",
      },
    ];
    if (opts.region) {
      reasons.push({ label: "Near your region", kind: "geo", score: 0.7, detail: String(opts.region) });
    }

    out.push(makeLead(domain, isHot ? "hot" : "warm", reasons));
  }

  // de-dupe by host
  const seen = new Set<string>();
  return out.filter(l => (seen.has(l.host) ? false : (seen.add(l.host), true)));
}

function toCSV(rows: Lead[]): string {
  const header = "id,host,platform,cat,title,created_at,temperature";
  const body = rows
    .map(l =>
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

// ---------- Parse buyer request (no ?? operators) ----------
function parseBuyerRequest(req: Request): BuyerRequest {
  const q = (req.query || {}) as Record<string, any>;
  const bRaw = (req.body as any) ?? {};
  let b: Record<string, any>;
  if (typeof bRaw === "string") {
    try { b = JSON.parse(bRaw); } catch { b = { raw: bRaw }; }
  } else {
    b = bRaw || {};
  }

  const supplierAny = firstDefined(
    b.supplier, q.supplier,
    b.domain, q.domain,
    b.supplierDomain, q.supplierDomain,
    b.host, q.host,
    b.website, q.website,
    b.url, q.url,
    b.source, q.source,
    b.source_url, q.source_url,
    b.supplier_url, q.supplier_url,
    b.d, q.d
  );

  const regionAny = firstDefined(
    b.region, q.region,
    b.geo, q.geo,
    b.us_only ? "us" : undefined,
    q.us_only ? "us" : undefined,
    b.usca ? "us/ca" : undefined,
    q.usca ? "us/ca" : undefined
  );

  const radiusAny = firstDefined(b.radiusMi, q.radiusMi, b.radius, q.radius, b.mi, q.mi, 50);
  const keywordsAny = firstDefined(b.keywords, q.keywords, b.kw, q.kw, "");

  const supplier = normalizeDomain(supplierAny);
  const region = regionAny ? String(regionAny).toLowerCase().trim() : undefined;
  const radiusMi = Number(radiusAny || 50) || 50;
  const keywords = String(keywordsAny || "").trim();

  return { supplier: supplier || undefined, region, radiusMi, keywords };
}

// ---------- Router ----------
export default function mountLeads(): Router {
  const router = Router();

  // Index
  router.get("/api/v1/leads", (_req, res) => {
    res.json({
      ok: true,
      endpoints: [
        "/api/v1/leads/hot",
        "/api/v1/leads/warm",
        "/api/v1/leads/:id",
        "/api/v1/leads/buyers",
        "/api/v1/leads/export.csv"
      ],
    });
  });

  // Lists
  router.get("/api/v1/leads/hot", (req, res) => {
    const limitStr = (req.query && (req.query as any).limit) ? String((req.query as any).limit) : "50";
    const lim = Math.max(0, Number(limitStr) || 50);
    res.json({ ok: true, items: hot.slice(0, lim) });
  });

  router.get("/api/v1/leads/warm", (req, res) => {
    const limitStr = (req.query && (req.query as any).limit) ? String((req.query as any).limit) : "50";
    const lim = Math.max(0, Number(limitStr) || 50);
    res.json({ ok: true, items: warm.slice(0, lim) });
  });

  // One lead
  router.get("/api/v1/leads/:id", (req, res) => {
    const lead = byId.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    res.json({ ok: true, temperature: lead.temperature, lead, why: lead.why });
  });

  // Stage
  router.patch("/api/v1/leads/:id/stage", (req, res) => {
    const lead = byId.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const stageStr = req.body ? (req.body.stage ?? (req as any).stage) : undefined;
    const stage = String(stageStr || "").toLowerCase() as Stage;
    if (!stage || !["new", "qualified", "contacted", "won", "lost"].includes(stage))
      return res.status(400).json({ ok: false, error: "bad stage" });
    lead.stage = stage;
    res.json({ ok: true, leadId: Number(lead.id), stage: lead.stage });
  });

  // Note
  router.post("/api/v1/leads/:id/note", (req, res) => {
    const lead = byId.get(String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const text = req.body ? (req.body.text ?? (req as any).text) : "";
    const t = String(text || "").trim();
    if (!t) return res.status(400).json({ ok: false, error: "empty" });
    (lead.notes ??= []).push({ ts: nowISO(), text: t });
    res.json({ ok: true, leadId: Number(lead.id) });
  });

  // CSV
  router.get("/api/v1/leads/export.csv", (req, res) => {
    const tempStr = (req.query && (req.query as any).temperature) ? String((req.query as any).temperature) : "hot";
    const limitStr = (req.query && (req.query as any).limit) ? String((req.query as any).limit) : "50";
    const temp = (tempStr === "warm" ? "warm" : "hot") as Temp;
    const lim = Math.max(0, Number(limitStr) || 50);
    const rows = (temp === "warm" ? warm : hot).slice(0, lim);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(toCSV(rows));
  });

  // ----- Buyer Finder (POST or GET; many field aliases) -----
  function handleBuyerFind(req: Request, res: Response) {
    const parsed = parseBuyerRequest(req);
    if (!parsed.supplier) {
      return res.status(400).json({
        ok: false,
        error: "supplier (domain) required",
        hint: "Use supplier=stretchandshrink.com (or supplierDomain/domain/host/url)",
      });
    }
    const before = NEXT_ID;
    const candidates = seedsAsLeads(parsed);
    const created = NEXT_ID - before;

    res.json({
      ok: true,
      supplierDomain: parsed.supplier,
      created,
      ids: candidates.map(l => Number(l.id)),
      candidates: candidates.map(l => ({
        cat: l.cat,
        platform: l.platform,
        host: l.host,
        title: l.title,
        keywords: l.why.find(w => w.kind === "signal")?.detail || "",
        temperature: l.temperature,
        why: l.why,
      })),
      tip: "Filtered to US/CA. Add region to bias toward a city or state.",
    });
  }

  router.post("/api/v1/leads/buyers", handleBuyerFind);
  router.get("/api/v1/leads/buyers", handleBuyerFind);
  router.post("/api/v1/leads/find-buyers", handleBuyerFind); // legacy alias
  router.get("/api/v1/leads/find-buyers", handleBuyerFind);  // legacy alias

  return router;
}
