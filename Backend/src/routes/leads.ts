import type { Application, Request, Response } from "express";
import express from "express";
import { requireApiKey } from "../auth";
import { scoreLead, type ScorePatch } from "../workers/score";

type Temperature = "hot" | "warm" | "cold";

type Lead = {
  id: number;
  platform: string;      // 'shopify' | 'woocommerce' | 'unknown'
  cat: string;           // 'product' | 'service'
  host: string;          // domain (no scheme)
  title: string;
  created_at: string;    // ISO
  temperature?: Temperature;
  why?: Array<{ label: string; kind: "meta" | "platform" | "signal"; score: number; detail?: string }>;
  stage?: "new" | "qualified" | "talking" | "won" | "lost";
  notes?: Array<{ at: string; text: string }>;
};

const leads = new Map<number, Lead>();
let idSeq = 1;

// Heuristic platform detector (no network)
function detectPlatformFromText(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("shopify")) return "shopify";
  if (s.includes("woocommerce") || s.includes("woo")) return "woocommerce";
  return "unknown";
}

function parseHost(raw?: string | null): string | null {
  if (!raw) return null;
  const r = raw.trim();
  if (!r) return null;
  if (r.startsWith("http://") || r.startsWith("https://")) {
    try { return new URL(r).host.toLowerCase(); } catch { return null; }
  }
  return r.replace(/^www\./i, "").toLowerCase();
}

function nowISO() { return new Date().toISOString(); }

function toPublic(l: Lead) {
  const { id, platform, cat, host, title, created_at, temperature, why } = l;
  return { id, platform, cat, host, title, created_at, temperature, why };
}

async function ingestOne(payload: any): Promise<Lead> {
  const host = parseHost(payload.source_url ?? payload.host);
  if (!host) {
    throw Object.assign(new Error("host or source_url required"), { status: 400 });
  }

  const id = idSeq++;
  const platform = (payload.platform && String(payload.platform)) ||
                   detectPlatformFromText([payload.title, host].filter(Boolean).join(" "));
  const title = (payload.title && String(payload.title)) || "Untitled";
  const cat = (payload.cat && String(payload.cat)) || "product";

  const lead: Lead = {
    id, platform, cat, host, title, created_at: nowISO(), stage: "new", notes: []
  };

  const kw: string[] | null = Array.isArray(payload.kw) ? payload.kw.map(String) : null;
  const scored: ScorePatch = await scoreLead({ id, host, title, platform, kw });
  lead.temperature = scored.temperature;
  lead.why = scored.why;

  leads.set(id, lead);
  return lead;
}

export function mountLeads(app: Application) {
  const router = express.Router();

  // Lists (note: defined before :id)
  router.get("/leads/hot", (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = [...leads.values()]
      .filter(l => l.temperature === "hot")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(toPublic);
    res.json({ ok: true, items });
  });

  router.get("/leads/warm", (req: Request, res: Response) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 10));
    const items = [...leads.values()]
      .filter(l => l.temperature === "warm")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(toPublic);
    res.json({ ok: true, items });
  });

  // CSV export
  router.get("/leads/export.csv", (req: Request, res: Response) => {
    const temperature = String(req.query.temperature || "").toLowerCase() as Temperature | "";
    const pick = [...leads.values()]
      .filter(l => (temperature ? l.temperature === temperature : true))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const rows = [
      "id,host,platform,cat,title,created_at,temperature",
      ...pick.map(l =>
        [
          JSON.stringify(l.id),
          JSON.stringify(l.host),
          JSON.stringify(l.platform),
          JSON.stringify(l.cat),
          JSON.stringify(l.title),
          JSON.stringify(new Date(l.created_at).toString()),
          JSON.stringify(l.temperature || "")
        ].join(",")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=leads.csv");
    res.send(rows);
  });

  // Ingest (single): only host/source_url is required; title optional
  router.post("/leads/ingest", requireApiKey, async (req: Request, res: Response) => {
    try {
      const lead = await ingestOne(req.body || {});
      res.json({ ok: true, temperature: lead.temperature, lead: toPublic(lead), why: lead.why });
    } catch (err: any) {
      res.status(err?.status || 400).json({ ok: false, error: String(err?.message || "bad request") });
    }
  });

  // Ingest (bulk)
  router.post("/leads/ingest/bulk", requireApiKey, async (req: Request, res: Response) => {
    const body = Array.isArray(req.body) ? req.body : [];
    const items = [];
    for (const p of body) {
      try { items.push(await ingestOne(p)); } catch { /* skip bad rows */ }
    }
    res.json({ ok: true, inserted: items.length, items: items.map(toPublic) });
  });

  // Get one
  router.get("/leads/:id", (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    res.json({ ok: true, temperature: lead.temperature || "warm", lead: toPublic(lead), why: lead.why || [] });
  });

  // PATCH stage
  router.patch("/leads/:id/stage", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const next = String(req.body?.stage || "").toLowerCase() as Lead["stage"];
    lead.stage = (["new", "qualified", "talking", "won", "lost"] as const).includes(next as any) ? next : "new";
    res.json({ ok: true, leadId: id, stage: lead.stage });
  });

  // Notes
  router.post("/leads/:id/notes", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const lead = leads.get(id);
    if (!lead) return res.status(404).json({ ok: false, error: "bad id" });
    const text = String(req.body?.note || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "note required" });
    lead.notes = lead.notes || [];
    lead.notes.push({ at: new Date().toISOString(), text });
    res.json({ ok: true, leadId: id });
  });

  app.use("/api/v1", router);
}

export default mountLeads;
