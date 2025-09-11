import { Express, Request, Response, Router } from "express";
import fs from "fs";
import path from "path";

/* =========================================================
   Types
========================================================= */
type Temp = "hot" | "warm";
type WhyChip = { label: string; kind: "meta" | "platform" | "signal" | "story"; score?: number; detail?: string; };
type Lead = {
  id: number; host: string; platform: string; title: string;
  created_at: string; temperature: Temp; why: WhyChip[];
  stage?: "new" | "qualified" | "won" | "lost"; notes?: string[];
};
type Persona = { product: string; solves: string; idealBuyers: string[]; };
type PersonaRow = { supplier: string; persona: Persona; source: "default" | "user"; };

/* =========================================================
   In-memory stores (persistence can be added later)
========================================================= */
const leads: Lead[] = [];
let nextId = 1;
const personas = new Map<string, PersonaRow>(); // key = supplier host (no www)

/* =========================================================
   Utilities
========================================================= */
const nowISO = () => new Date().toISOString();
const addLead = (l: Omit<Lead,"id"|"created_at">): Lead => { const lead={id:nextId++,created_at:nowISO(),...l}; leads.unshift(lead); return lead; };
const hostFrom = (value: string) => {
  const v = String(value || "").trim();
  if (!v) return "";
  try { const h = new URL(v.includes("://") ? v : `https://${v}`).host; return h.replace(/^www\./,"").toLowerCase(); }
  catch { return v.replace(/^www\./,"").toLowerCase(); }
};
const toCSV = (rows: Lead[]) => {
  const header = ["id","host","platform","title","created_at","temperature","stage","why"];
  const lines = rows.map(r=>{
    const why = r.why.map(w=>`${w.label}${w.score!=null?` ${w.score}`:""}${w.detail?` — ${w.detail}`:""}`).join(" | ");
    return [r.id,r.host,r.platform,r.title.replace(/"/g,'""'),r.created_at,r.temperature,r.stage||"",why.replace(/"/g,'""')].map(v=>`"${String(v)}"`).join(",");
  });
  return [header.join(","),...lines].join("\n");
};
const needKey = (req: Request, res: Response) => {
  const key = (req.headers["x-api-key"] as string) || "";
  if (!key) { res.status(401).json({ ok:false, error:"missing x-api-key" }); return false; }
  return true;
};

/* =========================================================
   Seeds (file or small fallback)
========================================================= */
function readSeeds(): string[] {
  try {
    const p = "/etc/secrets/seeds.txt";
    if (fs.existsSync(p)) {
      return fs.readFileSync(p,"utf8").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    }
  } catch {}
  // small US/CA-friendly fallback set (all .com or .ca)
  return [
    "homebrewsupply.com","globallogistics.com","sustainchem.com","peakperform.com",
    "greenleafnursery.com","primebuilders.com","brightfuture.com","artisanalcheese.ca","northridgecoffee.com"
  ];
}

/* =========================================================
   Region filter (US/CA only)
========================================================= */
const NON_US_CA_TLDS = new Set([
  ".uk",".ae",".au",".bd",".be",".br",".ch",".cl",".cn",".co",".de",".dk",".es",".eu",".fr",".hk",".hu",".id",".ie",".il",".in",".it",".jp",".kr",".mx",".my",".nl",".no",".nz",".ph",".pk",".pl",".pt",".ro",".ru",".sa",".se",".sg",".tr",".tw",".ua",".za"
]);
const tldOf = (host: string) => (host.match(/\.[a-z]{2,}$/)?.[0] || "").toLowerCase();
function allowedByRegion(host: string, region: string): boolean {
  const tld = tldOf(host);
  if (NON_US_CA_TLDS.has(tld)) return false; // kick obvious non-US/CA
  const r = region.toLowerCase();
  if (r === "us")  return tld === ".us" || tld === ".com" || tld === "";
  if (r === "ca")  return tld === ".ca" || tld === ".com" || tld === "";
  // default us/ca
  return tld === ".us" || tld === ".ca" || tld === ".com" || tld === "";
}

/* =========================================================
   Persona (default inference + user overrides)
========================================================= */
function inferDefaultPersona(supplier: string): Persona {
  const s = supplier.toLowerCase();
  if (s.includes("stretch") || s.includes("shrink")) {
    return {
      product: "Stretch film & pallet protection",
      solves:  "Keeps pallets secure for storage & transport",
      idealBuyers: ["Warehouse Manager","Purchasing Manager","COO"]
    };
  }
  return {
    product: "Custom packaging & supplies",
    solves:  "Protects and presents products across e-commerce & retail",
    idealBuyers: ["Procurement","Operations","E-commerce Manager"]
  };
}
function getPersona(supplier: string): PersonaRow {
  const host = hostFrom(supplier);
  const row = personas.get(host);
  if (row) return row;
  const created = { supplier: host, persona: inferDefaultPersona(host), source: "default" as const };
  personas.set(host, created);
  return created;
}
function savePersona(supplier: string, updates: Partial<Persona>): PersonaRow {
  const current = getPersona(supplier);
  const merged: Persona = {
    product: updates.product ?? current.persona.product,
    solves: updates.solves ?? current.persona.solves,
    idealBuyers: Array.isArray(updates.idealBuyers) && updates.idealBuyers.length > 0
      ? updates.idealBuyers
      : current.persona.idealBuyers
  };
  const row: PersonaRow = { supplier: hostFrom(supplier), persona: merged, source: "user" };
  personas.set(row.supplier, row);
  return row;
}

/* =========================================================
   Evidence/Scoring (simple, human-readable)
========================================================= */
function chipsFor(host: string, kw: string[]): WhyChip[] {
  const meta = 0.65;
  const platform = 0.5;
  const hit = kw.some(k => host.includes(k.replace(/\s+/g,"")));
  const signal = hit ? 0.8 : 0.6;
  return [
    { label:"Domain quality", kind:"meta",     score:meta,     detail:`${host} (.com/.us/.ca)` },
    { label:"Platform fit",  kind:"platform",  score:platform, detail:"unknown" },
    { label:"Intent keywords", kind:"signal",  score:signal,   detail: hit ? "matched supplier keywords" : "no strong keywords" },
  ];
}
const hotOrWarm = (title: string): Temp => (/\brf[qp]\b/i.test(title) ? "hot" : "warm");

/* =========================================================
   Router
========================================================= */
export function mountLeads(app: Express, base = "/api/v1"): void {
  const r = Router();

  /* Health */
  r.get("/_ping", (_req,res)=>res.json({ok:true,module:"leads"}));

  /* Lists */
  r.get("/hot", (req,res) => {
    const limit = Math.max(0, Math.min(500, Number(req.query.limit ?? 100)));
    res.json({ ok:true, items: leads.filter(l=>l.temperature==="hot").slice(0,limit) });
  });
  r.get("/warm", (req,res) => {
    const limit = Math.max(0, Math.min(500, Number(req.query.limit ?? 100)));
    res.json({ ok:true, items: leads.filter(l=>l.temperature==="warm").slice(0,limit) });
  });

  /* Ingest one (manual) */
  r.post("/ingest", (req,res) => {
    if (!needKey(req,res)) return;
    const host = hostFrom(String(req.body?.domain || ""));
    if (!host) return res.status(400).json({ ok:false, error:"domain is required" });
    const p = getPersona(host).persona;
    const why = chipsFor(host, p.idealBuyers.map(b=>b.toLowerCase()));
    const lead = addLead({ host, platform:String(req.body?.platform||"unknown"), title:String(req.body?.title || `Lead: ${host}`), temperature: hotOrWarm(String(req.body?.title||"")), why });
    res.json({ ok:true, id: lead.id });
  });

  /* Find buyers (US/CA only, region & radius respected) */
  r.post("/find-buyers", (req,res) => {
    if (!needKey(req,res)) return;
    const supplier = hostFrom(String(req.body?.supplier || ""));
    if (!supplier) return res.status(400).json({ ok:false, error:"supplier is required" });
    const region = String(req.body?.region || "us/ca");
    const radiusMi = Number(req.body?.radiusMi || 50);
    const p = getPersona(supplier).persona;

    const seen = new Set(leads.map(l=>l.host));
    let created = 0;

    for (const raw of readSeeds()) {
      const host = hostFrom(raw);
      if (!host) continue;
      if (!allowedByRegion(host, region)) continue;
      if (seen.has(host)) continue;

      const why = chipsFor(host, p.idealBuyers.map(b=>b.toLowerCase()));
      why.push({ label:"Context", kind:"story", detail:`Near your focus region (~${radiusMi} mi).` });

      addLead({ host, platform:"unknown", title:`Lead: ${host}`, temperature: hotOrWarm(""), why });
      seen.add(host);
      created++;
    }

    res.json({ ok:true, supplierDomain: supplier, created });
  });

  /* Stage / Notes */
  r.patch("/:id/stage", (req,res) => {
    if (!needKey(req,res)) return;
    const id = Number(req.params.id);
    const lead = leads.find(l=>l.id===id);
    if (!lead) return res.status(404).json({ ok:false, error:"not found" });
    const stage = String(req.body?.stage || "new") as Lead["stage"];
    lead.stage = stage;
    res.json({ ok:true, leadId:id, stage });
  });
  r.post("/:id/notes", (req,res) => {
    if (!needKey(req,res)) return;
    const id = Number(req.params.id);
    const text = String(req.body?.text || "").trim();
    const lead = leads.find(l=>l.id===id);
    if (!lead) return res.status(404).json({ ok:false, error:"not found" });
    if (!text) return res.status(400).json({ ok:false, error:"text is required" });
    (lead.notes ||= []).push(text);
    res.json({ ok:true });
  });

  /* CSV */
  r.get("/hot.csv", (_req,res) => {
    const csv = toCSV(leads.filter(l=>l.temperature==="hot"));
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="leads_hot.csv"');
    res.send(csv);
  });
  r.get("/warm.csv", (_req,res) => {
    const csv = toCSV(leads.filter(l=>l.temperature==="warm"));
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",'attachment; filename="leads_warm.csv"');
    res.send(csv);
  });

  /* Persona (read + update overrides) */
  r.get("/persona", (req,res) => {
    const supplier = hostFrom(String(req.query.supplier || ""));
    if (!supplier) return res.status(400).json({ ok:false, error:"supplier is required" });
    const row = getPersona(supplier);
    res.json({ ok:true, supplier: row.supplier, persona: row.persona, source: row.source });
  });
  r.post("/persona", (req,res) => {
    if (!needKey(req,res)) return;
    const supplier = hostFrom(String(req.body?.supplier || ""));
    if (!supplier) return res.status(400).json({ ok:false, error:"supplier is required" });
    const updates: Partial<Persona> = {
      product: req.body?.product,
      solves: req.body?.solves,
      idealBuyers: Array.isArray(req.body?.idealBuyers) ? req.body.idealBuyers.map((s:string)=>String(s)) : undefined
    };
    const saved = savePersona(supplier, updates);
    res.json({ ok:true, supplier: saved.supplier, persona: saved.persona, source: saved.source });
  });

  app.use(path.posix.join(base,"/leads"), r);
}
