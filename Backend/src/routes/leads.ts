// src/routes/leads.ts
import type { App } from "../index";

type WhyItem = { label: string; kind: "meta" | "platform" | "signal" | "context"; score: number; detail?: string };
export type Lead = {
  id: number;
  host: string;
  platform: string;
  title: string;
  created: number;
  temperature: "hot" | "warm";
  why: WhyItem[];
};

// very small in-mem seed (Northflank keeps container in memory per instance)
const hot: Lead[] = [];
const warm: Lead[] = [];

function toCSV(rows: Lead[]) {
  const header = "id,host,platform,title,created,temperature,why\n";
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = rows.map(r =>
    [r.id, r.host, r.platform, r.title, new Date(r.created).toISOString(), r.temperature,
     r.why.map(w => `${w.label}:${w.score}`).join("|")]
    .map(v => (typeof v === "string" ? esc(v) : String(v))).join(",")
  );
  return header + lines.join("\n");
}

export function mountLeads(app: App) {
  // list
  app.get("/api/v1/leads", (req, res) => {
    const t = (req.query.temp as string)?.toLowerCase();
    const data = t === "hot" ? hot : warm;
    res.json({ ok: true, items: data });
  });

  // csv
  app.get("/api/v1/leads.csv", (req, res) => {
    const t = (req.query.temp as string)?.toLowerCase();
    const data = t === "hot" ? hot : warm;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${t || "warm"}-leads.csv"`);
    res.send(toCSV(data));
  });

  // Find buyers for a supplier
  // body: { domain: string; region?: string; radiusMi?: number; keywords?: string }
  app.post("/api/v1/leads/find-buyers", (req, res) => {
    const { domain, region = "us", radiusMi = 50, keywords = "" } = req.body || {};
    if (!domain || typeof domain !== "string") {
      return res.status(400).json({ ok: false, error: "domain is required" });
    }
    // Stubbed result — your webscout/find pipeline will fill this in
    const created: Lead[] = [];
    res.json({ ok: true, supplierDomain: domain, region, radiusMi, keywords, created });
  });
}

export default mountLeads;
