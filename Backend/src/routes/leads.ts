// Backend/src/routes/leads.ts
import type { Express, Request, Response } from "express";
import { Router } from "express";
import { requireApiKey } from "../auth";

// -------- Types --------
type Temperature = "hot" | "warm";
type Stage = "new" | "qualified" | "contacted" | "won" | "lost";
type WhyItem = { label: string; kind: "meta" | "platform" | "signal"; score: number; detail: string };

export type Lead = {
  id: string;                 // keep as string for API stability
  platform: "shopify" | "woocommerce" | "other";
  cat: "product" | "service" | "other";
  host: string;               // domain only
  title: string;
  created_at: string;         // ISO
  temperature?: Temperature;  // set by simple rules here
  stage?: Stage;              // operator-controlled
  why?: WhyItem[];            // scoring explanation
  notes?: { text: string; at: string }[];
};

// -------- In-memory store (replace with DB later) --------
const LEADS = new Map<string, Lead>();
let nextId = 1;

// Optional: enable seeding only if explicitly asked (not by default)
const SEED_DEMO = process.env.SEED_DEMO === "1";
if (SEED_DEMO) {
  seed([
    mkLead({
      host: "brand-x.com",
      platform: "shopify",
      cat: "product",
      title: "RFQ: label refresh",
      temperature: "hot",
      why: [
        m("Domain quality", "meta", 0.65, "brand-x.com (.com)"),
        m("Platform fit", "platform", 0.75, "shopify"),
        m("Intent keywords", "signal", 0.9, "labels, rfq"),
      ],
    }),
    mkLead({
      host: "brand-a.com",
      platform: "shopify",
      cat: "product",
      title: "RFQ: label refresh",
      temperature: "hot",
      why: [
        m("Domain quality", "meta", 0.65, "brand-a.com (.com)"),
        m("Platform fit", "platform", 0.75, "shopify"),
        m("Intent keywords", "signal", 0.9, "labels, rfq"),
      ],
    }),
  ]);
}

// -------- Helpers --------
function m(label: string, kind: WhyItem["kind"], score: number, detail: string): WhyItem {
  return { label, kind, score, detail };
}

function mkLead(p: Partial<Lead>): Lead {
  const id = String(nextId++);
  const created_at = new Date().toISOString();
  return {
    id,
    platform: p.platform ?? "other",
    cat: p.cat ?? "other",
    host: p.host ?? "unknown",
    title: p.title ?? "Untitled",
    created_at,
    temperature: p.temperature,
    stage: "new",
    why: p.why ?? [],
    notes: [],
  };
}

function scoreFromKw(kw: string[]): { temperature: Temperature; why: WhyItem[] } {
  const text = kw.join(" ").toLowerCase();
  const signal =
    /rfq|rfp|tender|quote|packaging|carton|mailer|label|stretch|shrink|poly|box|corrugate/.test(text) ? 0.8 : 0.5;
  const temp: Temperature = signal >= 0.75 ? "hot" : "warm";
  return {
    temperature: temp,
    why: [
      m("Domain quality", "meta", 0.65, "derived from TLD"),
      m("Platform fit", "platform", 0.7, "heuristic"),
      m("Intent keywords", "signal", signal, kw.join(", ")),
    ],
  };
}

function hostFrom(urlOrDomain: string): string | null {
  let s = urlOrDomain.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pick<T>(arr: T[], limit?: number): T[] {
  const n = typeof limit === "number" && limit > 0 ? Math.min(limit, arr.length) : arr.length;
  return arr.slice(0, n);
}

function asCSV(leads: Lead[]): string {
  const rows = [
    ["id", "host", "platform", "cat", "title", "created_at", "temperature"].join(","),
    ...leads.map((l) =>
      [
        JSON.stringify(l.id),
        JSON.stringify(l.host),
        JSON.stringify(l.platform),
        JSON.stringify(l.cat),
        JSON.stringify(l.title),
        JSON.stringify(new Date(l.created_at).toString()),
        JSON.stringify(l.temperature ?? ""),
      ].join(","),
    ),
  ];
  return rows.join("\n");
}

function viewOf(l: Lead) {
  return {
    id: l.id,
    platform: l.platform,
    cat: l.cat,
    host: l.host,
    title: l.title,
    created_at: l.created_at,
    temperature: l.temperature,
    why: l.why ?? [],
  };
}

function indexByTemp(temp: Temperature): Lead[] {
  return Array.from(LEADS.values())
    .filter((l) => l.temperature === temp)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function parseLimit(req: Request): number | undefined {
  const s = String(req.query.limit ?? "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function bad(res: Response, error: string, code = 400) {
  return res.status(code).json({ ok: false, error });
}

// -------- Router --------
export function mountLeads(app: Express, base = "/api/v1/leads") {
  const r = Router();

  // list hot / warm (no auth)
  r.get("/hot", (req, res) => {
    const items = pick(indexByTemp("hot").map(viewOf), parseLimit(req));
    res.json({ ok: true, items });
  });

  r.get("/warm", (req, res) => {
    const items = pick(indexByTemp("warm").map(viewOf), parseLimit(req));
    res.json({ ok: true, items });
  });

  // get one (no auth)
  r.get("/:id", (req, res) => {
    const id = String(req.params.id);
    const lead = LEADS.get(id);
    if (!lead) return bad(res, "bad id", 404);
    const payload = { ok: true, temperature: lead.temperature, lead: viewOf(lead), why: lead.why ?? [] };
    res.json(payload);
  });

  // set stage (requires API key)
  r.patch("/:id/stage", requireApiKey, (req, res) => {
    const id = String(req.params.id);
    const lead = LEADS.get(id);
    if (!lead) return bad(res, "bad id", 404);
    const stage = String(req.body?.stage ?? "") as Stage;
    if (!stage) return bad(res, "missing stage");
    lead.stage = stage;
    res.json({ ok: true, leadId: Number(id), stage });
  });

  // add note (requires API key)
  r.post("/:id/notes", requireApiKey, (req, res) => {
    const id = String(req.params.id);
    const lead = LEADS.get(id);
    if (!lead) return bad(res, "bad id", 404);
    const text = String(req.body?.note ?? "").trim();
    if (!text) return bad(res, "missing note");
    lead.notes = lead.notes ?? [];
    lead.notes.push({ text, at: new Date().toISOString() });
    res.json({ ok: true, leadId: Number(id) });
  });

  // CSV export (no auth; UI already uses this)
  r.get("/export.csv", (req, res) => {
    const temperature = String(req.query.temperature ?? "").toLowerCase() as Temperature;
    if (temperature !== "hot" && temperature !== "warm") return bad(res, "temperature must be hot|warm");
    const rows = asCSV(indexByTemp(temperature));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(rows);
  });

  // ingest single (requires API key)
  r.post("/ingest", requireApiKey, (req, res) => {
    const body = req.body ?? {};
    const cat = String(body.cat ?? "").toLowerCase() as Lead["cat"];
    const platform = String(body.platform ?? "").toLowerCase() as Lead["platform"];
    const title = String(body.title ?? "").trim();
    const kw = Array.isArray(body.kw)
      ? body.kw.map((s: any) => String(s))
      : String(body.kw ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    const host = hostFrom(String(body.source_url ?? ""));

    if (!cat || !platform || !title || !host) {
      return bad(res, "cat, platform, source_url, title are required");
    }

    const { temperature, why } = scoreFromKw(kw);
    const lead = mkLead({ cat, platform, title, host, temperature, why });
    LEADS.set(lead.id, lead);

    res.json({ ok: true, temperature: lead.temperature, lead: viewOf(lead), why: lead.why });
  });

  // ingest bulk (requires API key)
  r.post("/ingest/bulk", requireApiKey, (req, res) => {
    const arr = Array.isArray(req.body) ? req.body : [];
    const items: ReturnType<typeof viewOf>[] = [];
    let inserted = 0;

    for (const it of arr) {
      const cat = String(it.cat ?? "").toLowerCase() as Lead["cat"];
      const platform = String(it.platform ?? "").toLowerCase() as Lead["platform"];
      const title = String(it.title ?? "").trim();
      const kw = Array.isArray(it.kw)
        ? it.kw.map((s: any) => String(s))
        : String(it.kw ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      const host = hostFrom(String(it.source_url ?? ""));

      if (!cat || !platform || !title || !host) continue;

      const { temperature, why } = scoreFromKw(kw);
      const lead = mkLead({ cat, platform, title, host, temperature, why });
      LEADS.set(lead.id, lead);
      items.push(viewOf(lead));
      inserted += 1;
    }

    res.json({ ok: true, inserted, items });
  });

  app.use(base, r);
}

// internal seed helper
function seed(leads: Lead[]) {
  for (const l of leads) {
    const id = String(nextId++);
    LEADS.set(id, { ...l, id });
  }
}
