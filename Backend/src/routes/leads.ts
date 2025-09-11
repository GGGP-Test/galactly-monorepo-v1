import type { Express, Request, Response } from "express";
import { requireApiKey } from "../auth";

// ----------------- types -----------------
type Temperature = "hot" | "warm";
type WhyItem = { label: string; kind: "meta" | "platform" | "signal"; score: number; detail: string };

interface Lead {
  id: number;
  platform: string;     // e.g., "shopify" | "woocommerce" | "unknown"
  cat: string;          // e.g., "product" | "service" | ""
  host: string;         // e.g., "brand-x.com"
  title: string;        // e.g., "RFP: mailers"
  created_at: string;   // ISO string
  temperature: Temperature;
  why: WhyItem[];
  stage?: string;       // "new" | "qualified" | ...
  notes?: { ts: string; text: string }[];
}

// ----------------- in-memory store -----------------
const leads: Lead[] = [];
let nextId = 1;

// ----------------- helpers -----------------
function nowISO() {
  return new Date().toISOString();
}

function parseHost(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return (u.host || "").replace(/^www\./i, "");
  } catch {
    // not a valid URL; treat as host-ish string
    return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  }
}

function scoreDomainQuality(host: string): WhyItem {
  // super simple heuristic
  const tld = host.split(".").pop() || "";
  const len = host.length;
  let score = 0.5;
  if (tld === "com") score += 0.15;
  if (len >= 8) score += 0.0; // neutral length bump
  return { label: "Domain quality", kind: "meta", score: Number(score.toFixed(2)), detail: `${host} (.${tld || "?"})` };
}

function scorePlatformFit(platform: string): WhyItem {
  const map: Record<string, number> = { shopify: 0.75, woocommerce: 0.6 };
  const p = (platform || "unknown").toLowerCase();
  const score = map[p] ?? 0.5;
  return { label: "Platform fit", kind: "platform", score, detail: p || "unknown" };
}

const INTENT = ["rfp", "rfq", "packaging", "carton", "labels", "mailers", "stretch", "poly", "pouch", "box", "film"];

function scoreIntent(keywords: string[], title: string): WhyItem {
  const hay = [title, ...(keywords || [])].join(" ").toLowerCase();
  const hits = INTENT.filter(k => hay.includes(k));
  // 0.9 if strong signals present, else 0.8 if some, else 0.6
  const score = hits.length >= 2 ? 0.9 : hits.length === 1 ? 0.8 : 0.6;
  const detail = hits.length ? hits.join(", ") : "no strong keywords";
  return { label: "Intent keywords", kind: "signal", score, detail };
}

function decideTemperature(why: WhyItem[]): Temperature {
  const meta = why.find(w => w.kind === "meta")?.score ?? 0;
  const plat = why.find(w => w.kind === "platform")?.score ?? 0;
  const sig = why.find(w => w.kind === "signal")?.score ?? 0;
  const total = meta + plat + sig;
  if (sig >= 0.85 || total >= 2.05) return "hot";
  return "warm";
}

function serializeLead(l: Lead) {
  // for single lead endpoint
  return {
    ok: true,
    temperature: l.temperature,
    lead: {
      id: String(l.id),
      platform: l.platform,
      cat: l.cat,
      host: l.host,
      title: l.title,
      created_at: l.created_at
    },
    why: l.why
  };
}

function toCSV(rows: Lead[]) {
  const header = `id,host,platform,cat,title,created_at,temperature`;
  const lines = rows.map(l =>
    [
      JSON.stringify(String(l.id)),
      JSON.stringify(l.host),
      JSON.stringify(l.platform),
      JSON.stringify(l.cat),
      JSON.stringify(l.title),
      JSON.stringify(new Date(l.created_at).toString()),
      JSON.stringify(l.temperature)
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

// ----------------- routes -----------------
export function mountLeads(app: Express) {
  const base = "/api/v1/leads";

  // list by temperature
  app.get(`${base}/hot`, (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = leads.filter(l => l.temperature === "hot").slice(-limit).reverse();
    res.json({ ok: true, items });
  });

  app.get(`${base}/warm`, (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = leads.filter(l => l.temperature === "warm").slice(-limit).reverse();
    res.json({ ok: true, items });
  });

  // single lead
  app.get(`${base}/:id`, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.find(l => l.id === id);
    if (!lead) return res.json({ ok: false, error: "bad id" });
    return res.json(serializeLead(lead));
  });

  // set stage
  app.patch(`${base}/:id/stage`, requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.find(l => l.id === id);
    if (!lead) return res.json({ ok: false, error: "bad id" });
    const stage = String(req.body?.stage || "").trim() || "new";
    lead.stage = stage;
    res.json({ ok: true, leadId: id, stage });
  });

  // add note
  app.post(`${base}/:id/notes`, requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.find(l => l.id === id);
    if (!lead) return res.json({ ok: false, error: "bad id" });
    const text = String(req.body?.note || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "note is required" });
    lead.notes = lead.notes || [];
    lead.notes.push({ ts: nowISO(), text });
    res.json({ ok: true, leadId: id });
  });

  // export CSV
  app.get(`${base}/export.csv`, (req: Request, res: Response) => {
    const temp = (String(req.query.temperature || "").toLowerCase() as Temperature) || undefined;
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    let rows = leads.slice().reverse();
    if (temp === "hot" || temp === "warm") rows = rows.filter(l => l.temperature === temp);
    rows = rows.slice(0, limit).reverse();
    const csv = toCSV(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  });

  // ingest (single) — accepts JUST a domain/url; other fields optional
  app.post(`${base}/ingest`, requireApiKey, (req: Request, res: Response) => {
    const body = req.body || {};
    const host = parseHost(body.source_url || body.host || "");
    if (!host) return res.status(400).json({ ok: false, error: "source_url or host is required" });

    const platform = String(body.platform || "unknown").toLowerCase();
    const cat = String(body.cat || "").toLowerCase() || "product";
    const title = String(body.title || `Lead: ${host}`).trim();
    const kw: string[] = Array.isArray(body.kw) ? body.kw.map((s: any) => String(s)) : [];

    const why: WhyItem[] = [
      scoreDomainQuality(host),
      scorePlatformFit(platform),
      scoreIntent(kw, title)
    ];
    const temperature = decideTemperature(why);

    const lead: Lead = {
      id: nextId++,
      platform,
      cat,
      host,
      title,
      created_at: nowISO(),
      temperature,
      why,
      stage: "new",
      notes: []
    };
    leads.push(lead);

    res.json({
      ok: true,
      temperature,
      lead: {
        id: String(lead.id),
        platform: lead.platform,
        cat: lead.cat,
        host: lead.host,
        title: lead.title,
        created_at: lead.created_at
      },
      why
    });
  });

  // ingest (bulk) — array of items; each can be domain-only
  app.post(`${base}/ingest/bulk`, requireApiKey, (req: Request, res: Response) => {
    const items = Array.isArray(req.body) ? req.body : [];
    let inserted = 0;
    const out: Lead[] = [];

    for (const raw of items) {
      const host = parseHost(raw?.source_url || raw?.host || "");
      if (!host) continue;
      const platform = String(raw.platform || "unknown").toLowerCase();
      const cat = String(raw.cat || "").toLowerCase() || "product";
      const title = String(raw.title || `Lead: ${host}`).trim();
      const kw: string[] = Array.isArray(raw.kw) ? raw.kw.map((s: any) => String(s)) : [];

      const why: WhyItem[] = [
        scoreDomainQuality(host),
        scorePlatformFit(platform),
        scoreIntent(kw, title)
      ];
      const temperature = decideTemperature(why);

      const lead: Lead = {
        id: nextId++,
        platform,
        cat,
        host,
        title,
        created_at: nowISO(),
        temperature,
        why,
        stage: "new",
        notes: []
      };
      leads.push(lead);
      out.push(lead);
      inserted++;
    }

    res.json({
      ok: true,
      inserted,
      items: out
    });
  });
}
