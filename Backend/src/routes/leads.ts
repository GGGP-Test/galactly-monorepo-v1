import { Express, Request, Response, Router } from "express";
import fs from "fs";
import path from "path";

// -------------------- Types --------------------

type Temp = "hot" | "warm";

type WhyChip = {
  label: string;                 // short label shown as a chip title
  kind: "meta" | "platform" | "signal" | "story"; // presentation group
  score?: number;                // 0..1 when relevant
  detail?: string;               // human text shown on the right
};

type Lead = {
  id: number;
  host: string;                  // domain only (e.g. brand-x.com)
  platform: string;              // "shopify" | "unknown" | etc.
  title: string;                 // short headline
  created_at: string;            // ISO
  temperature: Temp;             // hot | warm
  why: WhyChip[];                // evidence chips
  stage?: "new" | "qualified" | "won" | "lost";
  notes?: string[];
};

// -------------------- In-memory store --------------------
// NOTE: You can restart the instance and this resets; persistent storage
// will be wired later (for now we just need the API green and consistent).

const leads: Lead[] = [];
let nextId = 1;

function nowISO() {
  return new Date().toISOString();
}

function addLead(l: Omit<Lead, "id" | "created_at">): Lead {
  const lead: Lead = { id: nextId++, created_at: nowISO(), ...l };
  leads.unshift(lead);
  return lead;
}

function toCSV(rows: Lead[]): string {
  const header = [
    "id",
    "host",
    "platform",
    "title",
    "created_at",
    "temperature",
    "stage",
    "why",
  ];
  const lines = rows.map((r) => {
    const why = r.why
      .map((w) => `${w.label}${w.score != null ? ` ${w.score}` : ""}${w.detail ? ` — ${w.detail}` : ""}`)
      .join(" | ");
    return [
      r.id,
      r.host,
      r.platform,
      r.title.replace(/"/g, '""'),
      r.created_at,
      r.temperature,
      r.stage || "",
      why.replace(/"/g, '""'),
    ]
      .map((v) => `"${String(v)}"`)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

// -------------------- Seeds (optional) --------------------
// If present, we read /etc/secrets/seeds.txt (one domain per line).
// We also ship a small fallback list (US/CA only).

function readSeedDomains(): string[] {
  const secretPath = "/etc/secrets/seeds.txt";
  try {
    if (fs.existsSync(secretPath)) {
      const raw = fs.readFileSync(secretPath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && !s.startsWith("#"));
    }
  } catch {
    // ignore
  }
  return [
    "homebrewsupply.com",
    "globallogistics.com",
    "sustainchem.com",
    "peakperform.com",
    "greenleafnursery.com",
    "urbanGreens.com".toLowerCase(),
    "primebuilders.com",
    "brightfuture.com",
  ];
}

// -------------------- Helpers --------------------

function hostFromUrlOrHost(value: string): string {
  try {
    // If user pasted a full URL, URL() will parse it; otherwise treat as host.
    const h = new URL(value.includes("://") ? value : `https://${value}`).host;
    return h.replace(/^www\./, "").toLowerCase();
  } catch {
    return value.replace(/^www\./, "").toLowerCase();
  }
}

function requireApiKey(req: Request, res: Response): boolean {
  // For write actions only; allow any non-empty key for now.
  const key = (req.headers["x-api-key"] as string) || "";
  if (!key) {
    res.status(401).json({ ok: false, error: "missing x-api-key" });
    return false;
  }
  return true;
}

function personaFromSupplierDomain(supplierDomain: string) {
  // Super-light inference; we’ll swap in the real AI later.
  // Returns persona + likely buyer titles
  const s = supplierDomain.toLowerCase();
  if (s.includes("stretch") || s.includes("shrink")) {
    return {
      product: "stretch films & pallet protection",
      solves: "secure pallets for storage & transport",
      idealBuyers: ["Warehouse Manager", "Purchasing Manager", "COO"],
      keywords: ["stretch wrap", "pallet", "film", "warehouse"],
    };
  }
  return {
    product: "custom packaging",
    solves: "protect & present products",
    idealBuyers: ["Procurement", "Operations", "E-commerce Manager"],
    keywords: ["packaging", "carton", "labels", "rfp", "rfq"],
  };
}

function evidenceFromHost(host: string, personaKw: string[]): WhyChip[] {
  // Very lightweight signals (real signals will be wired next)
  const scoreMeta = 0.65; // domain quality placeholder
  const scorePlatform = 0.5; // unknown platform by default

  // Intent signals if host or title contains any persona keywords
  const intentHit = personaKw.some((kw) => host.includes(kw.replace(/\s+/g, "")));
  const scoreSignal = intentHit ? 0.8 : 0.6;

  return [
    { label: "Domain quality", kind: "meta", score: scoreMeta, detail: `${host} (.com)` },
    { label: "Platform fit", kind: "platform", score: scorePlatform, detail: "unknown" },
    {
      label: "Intent keywords",
      kind: "signal",
      score: scoreSignal,
      detail: intentHit ? "matched supplier keywords" : "no strong keywords",
    },
  ];
}

function hotOrWarm(title: string): Temp {
  // Treat RFP/RFQ as HOT
  const t = title.toLowerCase();
  return t.includes("rfp") || t.includes("rfq") ? "hot" : "warm";
}

// -------------------- Router --------------------

export function mountLeads(app: Express, base = "/api/v1"): void {
  const r = Router();

  // Health for this module (optional)
  r.get("/_ping", (_req, res) => res.json({ ok: true, module: "leads" }));

  // GET /hot
  r.get("/hot", (req: Request, res: Response) => {
    const limit = Math.max(0, Math.min(500, Number(req.query.limit ?? 100)));
    const items = leads.filter((l) => l.temperature === "hot").slice(0, limit);
    res.json({ ok: true, items });
  });

  // GET /warm
  r.get("/warm", (req: Request, res: Response) => {
    const limit = Math.max(0, Math.min(500, Number(req.query.limit ?? 100)));
    const items = leads.filter((l) => l.temperature === "warm").slice(0, limit);
    res.json({ ok: true, items });
  });

  // POST /ingest  (manual add; accepts just a domain/URL; other fields optional)
  r.post("/ingest", (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const { domain, platform, title, keywords } = req.body || {};
    const host = hostFromUrlOrHost(String(domain || ""));
    if (!host) return res.status(400).json({ ok: false, error: "domain is required" });

    const persona = personaFromSupplierDomain(host);
    const why = evidenceFromHost(host, persona.keywords);
    const temp: Temp = hotOrWarm(String(title || ""));

    const lead = addLead({
      host,
      platform: String(platform || "unknown"),
      title: String(title || `Lead: ${host}`),
      temperature: temp,
      why,
    });

    res.json({ ok: true, id: lead.id });
  });

  // POST /find-buyers  (panel button "Find buyers")
  // body: { supplier: string, region?: "us"|"ca"|"us/ca"|cityOrState, radiusMi?: number }
  r.post("/find-buyers", (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const supplier = hostFromUrlOrHost(String(req.body?.supplier || ""));
    if (!supplier) return res.status(400).json({ ok: false, error: "supplier is required" });

    const region = String(req.body?.region || "us/ca").toLowerCase();
    const radiusMi = Number(req.body?.radiusMi || 50);

    const persona = personaFromSupplierDomain(supplier);

    // Load seeds (US/CA only) then synthesize leads from them
    const seeds = readSeedDomains();
    let created = 0;
    for (const seed of seeds) {
      const host = hostFromUrlOrHost(seed);
      // Keep it US/CA only for now (your real geofilter will go here)
      if (!region.includes("us") && !region.includes("ca")) continue;

      const why = evidenceFromHost(host, persona.keywords);
      // Add one human "story" chip for friendliness
      why.push({
        label: "Context",
        kind: "story",
        detail: `Similar buyers near your region (~${radiusMi}mi).`,
      });

      const title = `Lead: ${host}`;
      const temperature: Temp = hotOrWarm(title);

      addLead({
        host,
        platform: "unknown",
        title,
        temperature,
        why,
      });
      created++;
    }

    res.json({ ok: true, supplierDomain: supplier, created });
  });

  // PATCH /:id/stage
  r.patch("/:id/stage", (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const id = Number(req.params.id);
    const stage = String(req.body?.stage || "new") as Lead["stage"];

    const lead = leads.find((l) => l.id === id);
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });

    lead.stage = stage;
    return res.json({ ok: true, leadId: id, stage });
  });

  // POST /:id/notes  (optional)
  r.post("/:id/notes", (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;
    const id = Number(req.params.id);
    const text = String(req.body?.text || "").trim();
    const lead = leads.find((l) => l.id === id);
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    if (!text) return res.status(400).json({ ok: false, error: "text is required" });
    lead.notes = lead.notes || [];
    lead.notes.push(text);
    res.json({ ok: true });
  });

  // CSV downloads the panel expects
  r.get("/hot.csv", (_req: Request, res: Response) => {
    const csv = toCSV(leads.filter((l) => l.temperature === "hot"));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads_hot.csv"');
    res.send(csv);
  });

  r.get("/warm.csv", (_req: Request, res: Response) => {
    const csv = toCSV(leads.filter((l) => l.temperature === "warm"));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads_warm.csv"');
    res.send(csv);
  });

  // Mount under base path
  app.use(path.posix.join(base, "/leads"), r);
}
