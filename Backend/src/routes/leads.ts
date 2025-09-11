// Backend/src/routes/leads.ts
//
// Leads API — US/CA filtering, simple buyer-finder, human-readable "Why".
// No external AI calls here yet (keeps builds green). Adds a POST /buyers
// endpoint that accepts a supplier domain and optional city/radius.
//
// Write actions (creating leads, setting stage, adding notes) require x-api-key.

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import url from "url";
import { requireApiKey } from "../auth";

type Temperature = "hot" | "warm";
type Stage = "new" | "qualified" | "contacted" | "won" | "lost";

type WhySentence = {
  label: string;            // e.g., "Recent activity"
  text: string;             // human-readable sentence
  weight?: number;          // internal ranking hint (not shown)
};

type Lead = {
  id: string;
  platform: string;
  cat: string;
  host: string;
  title: string;
  created_at: string;       // ISO
  temperature: Temperature;
  stage?: Stage;
  notes?: string[];
  why?: WhySentence[];      // human-readable evidence
};

type BuyersRequest = {
  supplierDomain: string;
  city?: string;            // "San Francisco, CA" or ZIP
  radiusMiles?: number;     // 25/50/100
  keywords?: string;        // optional hint (e.g., "rfp, corrugate")
};

// ----- in-memory store (persists for container lifetime) -----
const leads: Lead[] = [];
let nextId = 1;

// ----- utilities -----
const nowISO = () => new Date().toISOString();

function addLead(l: Omit<Lead, "id" | "created_at">): Lead {
  const lead: Lead = { ...l, id: String(nextId++), created_at: nowISO() };
  leads.unshift(lead); // newest first
  return lead;
}

function csvEscape(s: string) {
  const needs = /[,"\n]/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows: Array<Record<string, string>>) {
  if (rows.length === 0) return "id,host,platform,cat,title,created_at,temperature\n";
  const headers = Object.keys(rows[0]);
  const head = headers.join(",");
  const body = rows
    .map((r) => headers.map((h) => csvEscape(String(r[h] ?? ""))).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

// ----- seeds loader (US/CA only) -----
// File: /etc/secrets/seeds.txt   (one per line; we accept flexible formats)
// Accepted line shapes (comma or tab separated):
//   domain[,region][,industry][,name]
//   brand-x.com,US,food,Brand X
//   brand-x.com
// Any non-US/CA region gets filtered out by default.
type Seed = { host: string; region?: string; industry?: string; name?: string };

function parseSeedLine(line: string): Seed | null {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) return null;
  const parts = raw.split(/[\t,]+/).map((p) => p.trim()).filter(Boolean);
  const host = parts[0]?.toLowerCase();
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const region = parts[1]?.toUpperCase();
  const industry = parts[2];
  const name = parts[3];
  return { host, region, industry, name };
}

function loadSeeds(): Seed[] {
  const candidatePaths = [
    "/etc/secrets/seeds.txt",
    "/etc/secrets/seed.txt",
    path.join(process.cwd(), "seeds.txt"),
  ];
  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        const all = lines.map(parseSeedLine).filter((x): x is Seed => !!x);
        // US/CA only
        const usca = all.filter((s) => !s.region || s.region === "US" || s.region === "CA");
        return usca;
      }
    } catch {
      // ignore
    }
  }
  // tiny fallback list (US-only) to keep API usable if no seeds file exists
  return [
    { host: "brilliantearth.com", region: "US", industry: "retail" },
    { host: "sunbasket.com", region: "US", industry: "food" },
    { host: "gobble.com", region: "US", industry: "food" },
    { host: "dropps.com", region: "US", industry: "cpG" },
    { host: "wayfair.com", region: "US", industry: "retail" },
  ];
}

// ----- light heuristics (no external calls) -----
function domainQualitySentence(host: string): WhySentence {
  const tldOk = /\.(com|net|org|io|co)$/.test(host) ? "trusted TLD" : "valid domain";
  return {
    label: "Domain quality",
    text: `${host} looks like a real brand (${tldOk}).`,
    weight: 0.4,
  };
}

function packagingFamilyFromSupplier(hostOrText: string): "palletizing" | "labels" | "corrugate" | "mailers" | "protective" | "generic" {
  const h = hostOrText.toLowerCase();
  if (/(stretch|shrink|film)/.test(h)) return "palletizing";
  if (/(label|sticker)/.test(h)) return "labels";
  if (/(box|corrug|carton)/.test(h)) return "corrugate";
  if (/(mailer|poly|envelope)/.test(h)) return "mailers";
  if (/(foam|bubble|void|cushion)/.test(h)) return "protective";
  return "generic";
}

function packagingMathSentence(host: string): WhySentence {
  // Friendly explanation instead of numbers/jargon
  // (Heuristic: well-known brands/cart/retailers get this sentence)
  const plain = `They sell and ship products online — that means they already use packaging.`;
  return { label: "Business check", text: plain, weight: 0.5 };
}

function personaSentence(family: ReturnType<typeof packagingFamilyFromSupplier>): WhySentence {
  // Very simple, human-readable sentence
  const map: Record<string, string> = {
    palletizing: "Best matches warehouses, 3PLs and retail distribution centers (roles like Warehouse Manager or COO).",
    labels: "Best matches e-commerce brands and co-packers (roles like Purchasing or Ops Manager).",
    corrugate: "Best matches omni-channel brands and fulfillment centers (Purchasing / Packaging Engineer).",
    mailers: "Best matches DTC e-commerce brands and subscription services (E-commerce Ops / Procurement).",
    protective: "Best matches fragile goods brands and 3PLs (Ops / Packaging Engineer).",
    generic: "Best matches growing e-commerce brands and fulfillment centers.",
  };
  return { label: "Who this fits", text: map[family], weight: 0.4 };
}

function localitySentence(city?: string, radius?: number): WhySentence | undefined {
  if (!city) return undefined;
  return {
    label: "Location focus",
    text: `We’ll start near ${city} (about ${radius ?? 50} miles) and expand as needed — still US/CA only.`,
    weight: 0.3,
  };
}

function intentSentence(seed: Seed): WhySentence | undefined {
  // Without crawling, we can only add a generic hint when keywords are provided later.
  // Keep it simple for now:
  return undefined;
}

function toHotOrWarm(seed: Seed, family: ReturnType<typeof packagingFamilyFromSupplier>): Temperature {
  // Until we wire "recent activity" and RFQ detection, keep conservative:
  return "warm";
}

// create candidates from seeds, filtered by US/CA and lightly ranked by name/industry/heuristic family
function findBuyerCandidates(req: BuyersRequest): Lead[] {
  const seeds = loadSeeds();

  const family = packagingFamilyFromSupplier(req.supplierDomain);
  const city = req.city?.trim();
  const radius = req.radiusMiles ?? 50;

  // rank function: rough match of family to industry keywords (if present)
  const rank = (s: Seed) => {
    let r = 0;
    const h = `${s.host} ${s.industry ?? ""}`.toLowerCase();
    if (family === "palletizing" && /(3pl|warehouse|fulfill|distribution|logistic|retail)/.test(h)) r += 3;
    if (family === "labels" && /(beauty|food|supplement|beverage|retail|apparel)/.test(h)) r += 2;
    if (family === "corrugate" && /(retail|furniture|appliance|food|beverage)/.test(h)) r += 2;
    if (family === "mailers" && /(dtc|subscription|apparel|accessories)/.test(h)) r += 2;
    if (family === "protective" && /(fragile|glass|electronics|appliance)/.test(h)) r += 2;
    // domain looks brandy
    if (/\.(com)$/.test(s.host)) r += 1;
    return r;
  };

  const selected = seeds
    .filter((s) => !s.region || s.region === "US" || s.region === "CA")
    // (City/Radius is advisory in this phase — we don’t geocode; we’ll reflect it in a Why sentence.)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 12); // keep it small for the panel

  const friendlyWhyCommon: WhySentence[] = [
    domainQualitySentence(req.supplierDomain),
    packagingMathSentence(req.supplierDomain),
    personaSentence(family),
    ...(localitySentence(city, radius) ? [localitySentence(city, radius)!] : []),
  ];

  const created: Lead[] = [];
  for (const s of selected) {
    const temp: Temperature = toHotOrWarm(s, family);

    const why: WhySentence[] = [
      { label: "Match", text: `This looks like a likely buyer for your ${family === "generic" ? "packaging" : family.replace(/^\w/, c => c.toUpperCase())} products.` },
      ...friendlyWhyCommon,
    ];

    const lead = addLead({
      platform: "unknown",
      cat: "product",
      host: s.host,
      title: `Lead: ${s.name ?? s.host}`,
      temperature: temp,
      why,
    });

    created.push(lead);
  }
  return created;
}

// ----- router -----
export default function leadsRouter(): Router {
  const router = Router();

  // Health (used by Northflank readiness probe)
  router.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // Lists
  router.get("/hot", (req: Request, res: Response) => {
    const limit = Math.max(0, Math.min(100, Number(req.query.limit ?? 20)));
    const items = leads.filter((l) => l.temperature === "hot").slice(0, limit);
    res.json({ ok: true, items });
  });

  router.get("/warm", (req: Request, res: Response) => {
    const limit = Math.max(0, Math.min(100, Number(req.query.limit ?? 20)));
    const items = leads.filter((l) => l.temperature === "warm").slice(0, limit);
    res.json({ ok: true, items });
  });

  // One lead
  router.get("/:id", (req: Request, res: Response) => {
    const lead = leads.find((l) => l.id === String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    res.json({
      ok: true,
      temperature: lead.temperature,
      lead,
      why: lead.why ?? [],
    });
  });

  // Stage (requires API key)
  router.patch("/:id/stage", requireApiKey, (req: Request, res: Response) => {
    const lead = leads.find((l) => l.id === String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    const stage = (req.body?.stage ?? "new") as Stage;
    lead.stage = stage;
    res.json({ ok: true, leadId: Number(lead.id), stage });
  });

  // Notes (requires API key)
  router.post("/:id/notes", requireApiKey, (req: Request, res: Response) => {
    const lead = leads.find((l) => l.id === String(req.params.id));
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    const note = String(req.body?.note ?? "").trim();
    if (!note) return res.status(400).json({ ok: false, error: "note required" });
    if (!lead.notes) lead.notes = [];
    lead.notes.push(note);
    res.json({ ok: true, leadId: Number(lead.id) });
  });

  // CSV export
  router.get("/export.csv", (req: Request, res: Response) => {
    const temperature = String(req.query.temperature ?? "").toLowerCase() as Temperature | "";
    const limit = Math.max(0, Math.min(1000, Number(req.query.limit ?? 200)));
    const pool =
      temperature === "hot"
        ? leads.filter((l) => l.temperature === "hot")
        : temperature === "warm"
        ? leads.filter((l) => l.temperature === "warm")
        : leads;

    const pick = pool.slice(0, limit);
    const rows = pick.map((l) => ({
      id: l.id,
      host: l.host,
      platform: l.platform,
      cat: l.cat,
      title: l.title,
      created_at: new Date(l.created_at).toString(),
      temperature: l.temperature,
    }));
    const csv = toCSV(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="leads_${temperature || "all"}.csv"`);
    res.send(csv);
  });

  // NEW: Find buyers (requires API key)
  router.post("/buyers", requireApiKey, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as BuyersRequest;

    const supplierDomain = String(body.supplierDomain ?? "").trim().toLowerCase();
    if (!supplierDomain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(supplierDomain)) {
      return res.status(400).json({ ok: false, error: "supplierDomain is required (plain domain, no https://)" });
    }

    const city = body.city?.toString();
    const radiusMiles = Number(body.radiusMiles ?? 50);
    const created = findBuyerCandidates({ supplierDomain, city, radiusMiles, keywords: body.keywords });

    res.json({
      ok: true,
      supplierDomain,
      created: created.length,
      ids: created.map((c) => c.id),
    });
  });

  // (Optional compatibility) keep simple ingest for older panel versions
  router.post("/ingest", requireApiKey, (req: Request, res: Response) => {
    const source = String(req.body?.source_url ?? req.body?.source ?? req.body?.domain ?? "").trim().toLowerCase();
    if (!source) return res.status(400).json({ ok: false, error: "domain/source_url required" });
    const supplierDomain = source.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const created = findBuyerCandidates({ supplierDomain, radiusMiles: 50 });
    res.json({ ok: true, supplierDomain, created: created.length, ids: created.map((c) => c.id) });
  });

  return router;
}
