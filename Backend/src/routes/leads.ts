/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Router } from "express";
import { requireApiKey } from "../auth";
import { scoreLeadLLM, type ScorePatch } from "../workers/score";

type Temperature = "hot" | "warm" | "cold";
type SignalKind = "meta" | "platform" | "signal" | "ai" | "extract";

interface Signal {
  label: string;
  kind: SignalKind;
  score: number; // 0..1
  detail?: string;
}
interface Lead {
  id: string;
  platform: string;
  cat: string;
  host: string;
  title: string;
  created_at: string;
  temperature?: Temperature;
  why?: Signal[];
}
interface LeadRow extends Lead {
  notes?: { text: string; created_at: string }[];
  stage?: string;
}

// In-memory pool (same fixtures you’ve been seeing)
const LEADS_POOL: LeadRow[] = [
  { id: "123", platform: "shopify", cat: "product", host: "example.com", title: "RFP: e-com packaging project", created_at: "2025-09-09T15:42:16.505Z",
    temperature: "hot",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "example.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" },
      { label: "Intent keywords", kind: "signal", score: 0.9, detail: "packaging, carton, rfp" },
    ]
  },
  { id: "4", platform: "shopify", cat: "product", host: "example.com", title: "RFP: e-com packaging project", created_at: "2025-09-09T15:33:38.257Z",
    temperature: "hot",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "example.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" },
      { label: "Intent keywords", kind: "signal", score: 0.9, detail: "packaging, carton, rfp" },
    ]
  },
  { id: "3", platform: "shopify", cat: "product", host: "example.com", title: "RFP: e-com packaging project", created_at: "2025-09-09T15:24:30.105Z",
    temperature: "hot",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "example.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" },
      { label: "Intent keywords", kind: "signal", score: 0.9, detail: "packaging, carton, rfp" },
    ]
  },
  { id: "5", platform: "shopify", cat: "product", host: "brand-a.com", title: "RFQ: label refresh", created_at: "2025-09-09T19:51:45.318Z",
    temperature: "warm",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "brand-a.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" },
      { label: "Intent keywords", kind: "signal", score: 0.8, detail: "labels, rfq" },
    ]
  },
  { id: "6", platform: "woocommerce", cat: "product", host: "store-b.com", title: "RFP: poly mailers", created_at: "2025-09-09T19:51:45.595Z",
    temperature: "warm",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "store-b.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.6, detail: "woocommerce" },
      { label: "Intent keywords", kind: "signal", score: 0.8, detail: "packaging, mailers" },
    ]
  },
  { id: "7", platform: "shopify", cat: "product", host: "brand-x.com", title: "RFQ: label refresh", created_at: "2025-09-09T20:23:13.988Z",
    temperature: "hot",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "brand-x.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.75, detail: "shopify" },
      { label: "Intent keywords", kind: "signal", score: 0.9, detail: "labels, rfq" },
    ]
  },
  { id: "8", platform: "woocommerce", cat: "product", host: "store-y.com", title: "RFP: poly mailers", created_at: "2025-09-09T20:24:05.637Z",
    temperature: "warm",
    why: [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: "store-y.com (.com)" },
      { label: "Platform fit", kind: "platform", score: 0.6, detail: "woocommerce" },
      { label: "Intent keywords", kind: "signal", score: 0.8, detail: "mailers, packaging" },
    ]
  },
];

function byTemp(t: Temperature) {
  return LEADS_POOL.filter(x => (x.temperature || "warm") === t);
}
function getById(id: string) {
  return LEADS_POOL.find(x => x.id === id);
}
function toCSVRow(l: LeadRow): string[] {
  return [
    l.id, l.host, l.platform, l.cat, l.title,
    new Date(l.created_at).toString(), l.temperature || ""
  ].map(v => `"${(v ?? "").toString().replace(/"/g,'""')}"`);
}

// -------------------------------------
// Router
// -------------------------------------
const router = Router();

// Lists
router.get("/hot", (_req, res) => {
  res.json({ ok: true, items: byTemp("hot") });
});
router.get("/warm", (_req, res) => {
  res.json({ ok: true, items: byTemp("warm") });
});

// One lead
router.get("/:id", (req, res) => {
  const id = String(req.params.id || "");
  const row = getById(id);
  if (!row) return res.status(404).json({ ok: false, error: "bad id" });
  const { temperature, why, ...lead } = row;
  res.json({ ok: true, temperature, lead, why: row.why || [] });
});

// Stage & notes (require API key)
router.patch("/:id/stage", requireApiKey, (req, res) => {
  const id = String(req.params.id || "");
  const row = getById(id);
  if (!row) return res.status(404).json({ ok: false, error: "bad id" });
  const stage = String(req.body?.stage || "new");
  row.stage = stage;
  res.json({ ok: true, leadId: Number(id) || id, stage });
});

router.post("/:id/notes", requireApiKey, (req, res) => {
  const id = String(req.params.id || "");
  const row = getById(id);
  if (!row) return res.status(404).json({ ok: false, error: "bad id" });
  const note = String(req.body?.note || "");
  if (!note) return res.status(400).json({ ok: false, error: "note_required" });
  row.notes = row.notes || [];
  row.notes.push({ text: note, created_at: new Date().toISOString() });
  res.json({ ok: true, leadId: Number(id) || id });
});

// CSV export (no auth)
router.get("/export.csv", async (req, res) => {
  const temp = (String(req.query.temperature || "hot").toLowerCase() as Temperature);
  const items = byTemp(temp);
  const rows = [
    ["id","host","platform","cat","title","created_at","temperature"],
    ...items.map(toCSVRow)
  ].map(cols => cols.join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads_${temp}.csv"`);
  res.send(rows + "\n");
});

// Ingest (single) — auth, then AI score (if configured)
router.post("/ingest", requireApiKey, async (req, res) => {
  const { cat, kw, platform, source_url, title } = req.body || {};
  if (!cat || !platform || !source_url || !title) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }
  const host = tryHost(source_url);
  const id = String(nextId());
  const created_at = new Date().toISOString();

  // basic signals
  const why: Signal[] = [
    { label: "Domain quality", kind: "meta", score: 0.65, detail: `${host} (.${host.split(".").pop()})` },
    { label: "Platform fit", kind: "platform", score: platformScore(platform), detail: platform },
    { label: "Intent keywords", kind: "signal", score: kwScore(kw), detail: Array.isArray(kw)?kw.join(", "):String(kw||"") }
  ];

  let temperature: Temperature = kwScore(kw) >= 0.85 ? "hot" : "warm";
  let packagingMath: ScorePatch["packagingMath"] | undefined;

  // AI scoring if configured
  try {
    const patch = await scoreLeadLLM({ id, title, host, platform, cat, created_at });
    if (patch) {
      temperature = patch.temperature || temperature;
      packagingMath = patch.packagingMath;
      (patch.why || []).forEach(s => why.push(s));
    }
  } catch { /* non-fatal */ }

  const lead: LeadRow = { id, platform, cat, host, title, created_at, temperature, why };
  LEADS_POOL.push(lead);

  res.json({ ok: true, temperature, lead: copyLead(lead), why, packagingMath });
});

// Ingest (bulk) — array of single payloads
router.post("/ingest/bulk", requireApiKey, async (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : [];
  let inserted = 0;
  const items: any[] = [];
  for (const x of arr) {
    const body = { ...x };
    // simulate calling the single endpoint logic without extra HTTP hop
    const fakeReq: any = { body };
    const fakeRes: any = {
      statusCode: 200,
      status: (_: number) => fakeRes,
      json: (o: any) => items.push(o)
    };
    // small inline mimic
    if (!body.cat || !body.platform || !body.source_url || !body.title) continue;
    const host = tryHost(body.source_url);
    const id = String(nextId());
    const created_at = new Date().toISOString();
    const why: Signal[] = [
      { label: "Domain quality", kind: "meta", score: 0.65, detail: `${host} (.${host.split(".").pop()})` },
      { label: "Platform fit", kind: "platform", score: platformScore(body.platform), detail: body.platform },
      { label: "Intent keywords", kind: "signal", score: kwScore(body.kw), detail: Array.isArray(body.kw)?body.kw.join(", "):String(body.kw||"") }
    ];
    let temperature: Temperature = kwScore(body.kw) >= 0.85 ? "hot" : "warm";
    let packagingMath: ScorePatch["packagingMath"] | undefined;

    try {
      const patch = await scoreLeadLLM({ id, title: body.title, host, platform: body.platform, cat: body.cat, created_at });
      if (patch) {
        temperature = patch.temperature || temperature;
        packagingMath = patch.packagingMath;
        (patch.why || []).forEach(s => why.push(s));
      }
    } catch {}

    const lead: LeadRow = { id, platform: body.platform, cat: body.cat, host, title: body.title, created_at, temperature, why };
    LEADS_POOL.push(lead);
    inserted++;
    items.push({ ...copyLead(lead), temperature, why, packagingMath });
  }
  res.json({ ok: true, inserted, items });
});

// Re-score an existing lead (auth)
router.post("/:id/score", requireApiKey, async (req, res) => {
  const id = String(req.params.id || "");
  const row = getById(id);
  if (!row) return res.status(404).json({ ok: false, error: "bad id" });

  try {
    const patch = await scoreLeadLLM(row);
    if (!patch) return res.status(501).json({ ok: false, error: "ai_not_configured" });

    // merge
    row.temperature = patch.temperature || row.temperature;
    row.why = (row.why || []).concat(patch.why || []);
    const { temperature, why } = row;
    res.json({ ok: true, temperature, lead: copyLead(row), why, packagingMath: patch.packagingMath });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------------------------
// helpers
// -------------------------------------
function kwScore(kw: any): number {
  const s = (Array.isArray(kw) ? kw.join(" ") : String(kw || "")).toLowerCase();
  let score = 0.5;
  if (/rfp|rfq|tender|bid/.test(s)) score = Math.max(score, 0.9);
  if (/packaging|carton|label|mailer/.test(s)) score = Math.max(score, 0.8);
  return Math.min(1, score);
}
function platformScore(p: any): number {
  const s = String(p || "").toLowerCase();
  if (s.includes("shopify")) return 0.75;
  if (s.includes("woocommerce")) return 0.6;
  return 0.5;
}
function tryHost(url: string): string {
  try { return new URL(url).host; } catch { return "unknown"; }
}
let _id = 9;
function nextId() { return _id++; }
function copyLead(l: LeadRow) {
  const { temperature, why, notes, stage, ...lead } = l;
  return lead;
}

// -------------------------------------
// mount
// -------------------------------------
export function mountLeads(app: express.Express) {
  app.use("/api/v1/leads", router);
}
