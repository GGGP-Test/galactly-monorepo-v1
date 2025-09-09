import express from "express";
import { q } from "../db";
import { requireApiKey } from "../auth";

type LeadRow = {
  id: number;
  cat: string | null;
  kw: string[] | null;
  platform: string | null;
  source_url: string | null;
  title: string | null;
  snippet: string | null;
  created_at: string;
};

type Why = { label: string; kind: "meta"|"platform"|"signal"; score: number; detail: string };

function hostOf(u?: string | null): string | null {
  try { return u ? new URL(u).host : null; } catch { return null; }
}

function clamp(n: number, lo = 0, hi = 1){ return Math.max(lo, Math.min(hi, n)); }

function scoreLead(row: LeadRow){
  const host = hostOf(row.source_url) || hostOf("https://example.com")!;

  // Domain quality (very simple)
  const tld = host.includes(".") ? host.split(".").pop()!.toLowerCase() : "";
  const dq = ["com","ca","co","io","ai"].includes(tld) ? 0.65 : 0.30;

  // Platform fit
  const platform = (row.platform||"").toLowerCase();
  const pf = platform === "shopify" ? 0.75
          : platform === "woocommerce" ? 0.60
          : platform === "magento" ? 0.55
          : 0.50;

  // Intent keywords
  const kws = (row.kw||[]).map(k => (k||"").toLowerCase());
  const hasRfx = kws.some(k => k.includes("rfp") || k.includes("rfq"));
  const hasPack = kws.some(k => ["packaging","carton","mailers","labels"].includes(k));
  const intent = hasRfx ? 0.90 : hasPack ? 0.80 : 0.55;

  const why: Why[] = [
    { label:"Domain quality", kind:"meta",     score: dq,     detail: `${host} (.${tld||"?"})` },
    { label:"Platform fit",   kind:"platform", score: pf,     detail: platform||"unknown" },
    { label:"Intent keywords",kind:"signal",   score: intent, detail: kws.join(", ") || "n/a" },
  ];

  const avg = clamp((dq + pf + intent) / 3);
  const temperature: "hot" | "warm" | "cold" =
    (intent >= 0.85 && pf >= 0.70) ? "hot"
    : (intent >= 0.75) ? "warm"
    : "cold";

  return {
    temperature,
    why,
    host,
    confidence: avg
  };
}

function shapeLead(row: LeadRow){
  const s = scoreLead(row);
  return {
    id: String(row.id),
    platform: row.platform || "unknown",
    cat: row.cat || "unknown",
    host: s.host,
    title: row.title || s.host,
    created_at: row.created_at,
    temperature: s.temperature,
    why: s.why
  };
}

function parseLimit(v: any, dflt = 20){
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : dflt;
}

const router = express.Router();

/* ---------- LISTS FIRST (to avoid shadowing by "/:id") ---------- */

router.get("/hot", async (req, res) => {
  try{
    const limit = parseLimit(req.query.limit);
    const r = await q<LeadRow>(`
      SELECT id, cat, kw, platform, source_url, title, snippet, created_at
        FROM lead_pool
       ORDER BY created_at DESC
       LIMIT $1
    `, [limit*3]); // grab a bit more then filter
    const items = r.rows.map(shapeLead).filter(x => x.temperature === "hot").slice(0, limit);
    res.json({ ok:true, items });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

router.get("/warm", async (req, res) => {
  try{
    const limit = parseLimit(req.query.limit);
    const r = await q<LeadRow>(`
      SELECT id, cat, kw, platform, source_url, title, snippet, created_at
        FROM lead_pool
       ORDER BY created_at DESC
       LIMIT $1
    `, [limit*3]);
    const items = r.rows.map(shapeLead).filter(x => x.temperature === "warm").slice(0, limit);
    res.json({ ok:true, items });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

router.get("/export.csv", requireApiKey, async (req, res) => {
  try{
    const temp = (String(req.query.temperature||"").toLowerCase());
    if (!["hot","warm"].includes(temp)) return res.status(400).json({ ok:false, error:"bad temperature" });
    const limit = parseLimit(req.query.limit, 50);

    const r = await q<LeadRow>(`
      SELECT id, cat, kw, platform, source_url, title, snippet, created_at
        FROM lead_pool
       ORDER BY created_at DESC
       LIMIT $1
    `, [limit*3]);

    const rows = r.rows.map(shapeLead).filter(x => x.temperature === temp).slice(0, limit);

    const header = ["id","host","platform","cat","title","created_at","temperature"];
    const lines = [header.join(",")].concat(rows.map(row => {
      const fields = [
        row.id, row.host, row.platform, row.cat, row.title||"", row.created_at, row.temperature
      ].map(v => `"${String(v??"").replace(/"/g,'""')}"`);
      return fields.join(",");
    }));

    res.set("Content-Type","text/csv");
    res.set("Content-Disposition", `attachment; filename="leads_${temp}.csv"`);
    res.send(lines.join("\n"));
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

/* ---------- Ingest endpoints (admin) ---------- */

router.post("/ingest", requireApiKey, express.json(), async (req, res) => {
  try{
    const b = req.body || {};
    const kw = Array.isArray(b.kw) ? b.kw.map((s:any)=>String(s)) : [];
    const r = await q<LeadRow>(`
      INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, cat, kw, platform, source_url, title, snippet, created_at
    `, [String(b.cat||""), kw, String(b.platform||""), String(b.source_url||""), String(b.title||""), String(b.snippet||"")]);
    const lead = shapeLead(r.rows[0]);
    res.json({ ok:true, temperature: lead.temperature, lead, why: lead.why });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

router.post("/ingest/bulk", requireApiKey, express.json(), async (req, res) => {
  try{
    const a = Array.isArray(req.body) ? req.body : [];
    const out:any[] = [];
    for (const b of a){
      const kw = Array.isArray(b.kw) ? b.kw.map((s:any)=>String(s)) : [];
      const r = await q<LeadRow>(`
        INSERT INTO lead_pool(cat, kw, platform, source_url, title, snippet)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, cat, kw, platform, source_url, title, snippet, created_at
      `, [String(b.cat||""), kw, String(b.platform||""), String(b.source_url||""), String(b.title||""), String(b.snippet||"")]);
      out.push(shapeLead(r.rows[0]));
    }
    res.json({ ok:true, inserted: out.length, items: out });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

/* ---------- Per-lead actions (admin) ---------- */

router.patch("/:id/stage", requireApiKey, express.json(), async (req, res) => {
  try{
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok:false, error:"bad id" });

    const stage = String(req.body?.stage||"").toLowerCase();
    const allowed = new Set(["new","qualified","contacted","proposal","won","lost"]);
    if (!allowed.has(stage)) return res.status(400).json({ ok:false, error:"bad stage" });

    await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
             VALUES ($1,$2,$3,$4)`,
      ["api", id, "stage", { stage } as any]);
    res.json({ ok:true, leadId:id, stage });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

router.post("/:id/notes", requireApiKey, express.json(), async (req, res) => {
  try{
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok:false, error:"bad id" });

    const note = String(req.body?.note||"").trim();
    if (!note) return res.status(400).json({ ok:false, error:"empty note" });

    await q(`INSERT INTO event_log(user_id, lead_id, event_type, meta)
             VALUES ($1,$2,$3,$4)`,
      ["api", id, "note", { note } as any]);
    res.json({ ok:true, leadId:id });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

/* ---------- Get one (keep LAST) ---------- */

router.get("/:id", async (req, res) => {
  try{
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ ok:false, error:"bad id" });

    const r = await q<LeadRow>(`
      SELECT id, cat, kw, platform, source_url, title, snippet, created_at
        FROM lead_pool WHERE id=$1 LIMIT 1
    `, [id]);
    const row = r.rows[0];
    if (!row) return res.status(404).json({ ok:false, error:"not_found" });

    const lead = shapeLead(row);
    res.json({ ok:true, temperature: lead.temperature, lead, why: lead.why });
  }catch(e:any){
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

/* ---------- mount ---------- */

export function mountLeads(app: express.Express){
  app.use("/api/v1/leads", router);
}
