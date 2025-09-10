import type { Application, Request, Response } from "express";
import express from "express";
import { requireApiKey } from "../auth";

// ---------------- types & in-memory store ----------------

type Temperature = "hot" | "warm" | "cold";

type Why = {
  label: string;
  kind: "meta" | "platform" | "signal";
  score: number;      // 0..1
  detail?: string;
};

type Lead = {
  id: number;
  platform: string;   // 'shopify' | 'woocommerce' | 'unknown'
  cat: string;        // 'product' | 'service'
  host: string;       // normalized domain (no scheme)
  title: string;
  created_at: string; // ISO
  temperature: Temperature;
  why: Why[];
  stage?: "new" | "qualified" | "talking" | "won" | "lost";
  notes?: Array<{ at: string; text: string }>;
};

const leads = new Map<number, Lead>();
let idSeq = 1;

// ---------------- helpers ----------------

function isoNow() { return new Date().toISOString(); }

function normHost(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try { s = new URL(s).host; } catch { return null; }
  }
  return s.replace(/^www\./i, "").toLowerCase();
}

function detectPlatform(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("shopify")) return "shopify";
  if (t.includes("woocommerce") || t.includes("woo")) return "woocommerce";
  return "unknown";
}

// self-contained initial scoring: no external imports
function initialScore(blob: string): { temperature: Temperature; why: Why[] } {
  const t = blob.toLowerCase();
  const why: Why[] = [];
  if (/\.(com|net|org|io|co)\b/.test(t)) {
    why.push({ label: "Domain quality", kind: "meta", score: 0.65, detail: "domain present" });
  }
  if (t.includes("shopify")) {
    why.push({ label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" });
  } else if (/(woocommerce|wp\-?commerce|woo)/.test(t)) {
    why.push({ label: "Platform fit", kind: "platform", score: 0.6, detail: "woocommerce" });
  }
  if (/\brfp\b|\brfq\b|\btender\b|\bbid\b|\bproposal\b/.test(t) || /packaging|labels?|cartons?|mailers?/.test(t)) {
    why.push({ label: "Intent keywords", kind: "signal", score: 0.8, detail: "rfp/rfq/packaging" });
  }
  const temp: Temperature = why.some(w => w.kind === "signal") ? "hot" : why.length ? "warm" : "cold";
  return { temperature: temp, why };
}

function pub(l: Lead) {
  const { id, platform, cat, host, title, created_at, temperature, why } = l;
  return { id, platform, cat, host, title, created_at, temperature, why };
}

// ---------------- core logic ----------------

async function ingestOne(payload: any): Promise<Lead> {
  const host = normHost(payload.host ?? payload.source_url);
  if (!host) {
    const err: any = new Error("host or source_url required");
    err.status = 400;
    throw err;
  }

  const title = (payload.title ? String(payload.title) : "Untitled").trim();
  const platform = (payload.platform ? String(payload.platform) : detectPlatform(`${title} ${host}`));
  const cat = (payload.cat ? String(payload.cat) : "product");

  const id = idSeq++;
  const scored = initialScore([title, host, platform, (Array.isArray(payload.kw) ? payload.kw.join(",") : "")].join(" | "));

  const lead: Lead = {
    id,
    platform,
    cat,
    host,
    title,
    created_at: isoNow(),
    temperature: scored.temperature,
    why: scored.why,
    stage: "new",
    notes: []
  };

  leads.set(id, lead);
  return lead;
}

// ---------------- router ----------------

export function mountLeads(app: Application) {
  const r = express.Router();

  // Lists
  r.get("/leads/hot", (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = [...leads.values()]
      .filter(l => l.temperature === "hot")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(pub);
    res.json({ ok: true, items });
  });

  r.get("/leads/warm", (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = [...leads.values()]
      .filter(l => l.temperature === "warm")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(pub);
    res.json({ ok: true, items });
  });

  // CSV export (optional temperature=hot|warm)
  r.get("/leads/export.csv", (req: Request, res: Response) => {
    const temp = String(req.query.temperature || "").toLowerCase() as Temperature | "";
    const pick = [...leads.values()]
      .filter(l => (temp ? l.temperature === temp : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const rows = [
      "id,host,platform,cat,title,created_at,temperature",
      ...pick.map(l => [
        JSON.stringify(l.id),
        JSON.stringify(l.host),
        JSON.stringify(l.platform),
        JSON.stringify(l.cat),
        JSON.stringify(l.title),
        JSON.stringify(new Date(l.created_at).toString()),
        JSON.stringify(l.temperature)
      ].join(","))
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
    res.send(rows);
  });

  // Get one
  r.get("/leads/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    res.json({ ok: true, temperature: lead.temperature, lead: pub(lead), why: lead.why });
  });

  // Ingest (single): only host/source_url is required
  r.post("/leads/ingest", requireApiKey, async (req: Request, res: Response) => {
    try {
      const lead = await ingestOne(req.body || {});
      res.json({ ok: true, temperature: lead.temperature, lead: pub(lead), why: lead.why });
    } catch (e: any) {
      res.status(e?.status || 400).json({ ok: false, error: e?.message || "bad request" });
    }
  });

  // Ingest (bulk)
  r.post("/leads/ingest/bulk", requireApiKey, async (req: Request, res: Response) => {
    const body = Array.isArray(req.body) ? req.body : [];
    const items: Lead[] = [];
    for (const p of body) {
      try { items.push(await ingestOne(p)); } catch { /* skip bad rows */ }
    }
    res.json({ ok: true, inserted: items.length, items: items.map(pub) });
  });

  // PATCH stage
  r.patch("/leads/:id/stage", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const next = String(req.body?.stage || "").toLowerCase();
    if (!["new", "qualified", "talking", "won", "lost"].includes(next)) {
      return res.status(400).json({ ok: false, error: "invalid stage" });
    }
    lead.stage = next as Lead["stage"];
    res.json({ ok: true, leadId: id, stage: lead.stage });
  });

  // notes
  r.post("/leads/:id/notes", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const text = String(req.body?.note || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "note required" });
    if (!lead.notes) lead.notes = [];
    lead.notes.push({ at: new Date().toISOString(), text });
    res.json({ ok: true, leadId: id });
  });

  app.use("/api/v1", r);
}

export default mountLeads;
