import type { Express, Request, Response } from "express";
import { Router } from "express";
import fs from "fs";

// ---------- types ----------
export type Temperature = "hot" | "warm";

export interface Why {
  label?: string;
  kind?: "meta" | "platform" | "signal" | "persona" | "geo" | "pmath";
  score?: number;
  detail?: string;
}

export interface Lead {
  id: number | string;
  host: string;
  platform: string | "unknown";
  title: string;
  created_at: string; // ISO
  temperature: Temperature;
  why: Why[];
}

type Stage = "new" | "qualified" | "contacted" | "won" | "lost";

interface FindBuyersBody {
  supplier: string;      // domain: stretchandshrink.com
  region?: string;       // "us" | "ca" | "us-ca" | "City, ST"
  radiusMi?: number;     // 50
  limit?: number;        // default 50
  keywords?: string[];   // optional
}

// ---------- storage (in-memory) ----------
const leads: Lead[] = [];
const stages = new Map<string | number, Stage>();
const notes = new Map<string | number, string[]>();
let nextId = 1;

// ---------- const ----------
const BASE = "/api/v1/leads";

// ---------- helpers ----------
const nowISO = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

function score(kind: Why["kind"], detail: string, value: number): Why {
  return { kind, detail, score: round2(value) };
}

function toNum(id: string | number): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : nextId++;
}

function clampInt(s: unknown, min: number, max: number): number {
  const n = Number.parseInt(String(s ?? ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function requireApiKey(req: Request): string | null {
  const raw =
    (req.headers["x-api-key"] as string | undefined) ??
    (req.headers["X-API-Key"] as string | undefined);
  if (!raw) return null;
  const k = String(raw).trim();
  return k ? k : null;
}

function readSeedsUSCA(): string[] {
  const file = "/etc/secrets/seeds.txt";
  try {
    if (fs.existsSync(file)) {
      const deny = new Set([
        ".uk",
        ".ae",
        ".az",
        ".au",
        ".eu",
        ".de",
        ".fr",
        ".it",
        ".es",
        ".in",
        ".sg",
        ".hk",
        ".cn",
      ]);
      return fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .filter((d) => {
          const dot = d.lastIndexOf(".");
          const tld = dot >= 0 ? d.slice(dot) : "";
          if (deny.has(tld)) return false;
          return tld === ".com" || tld === ".us" || tld === ".ca" || /(us|usa|canada)/.test(d);
        });
    }
  } catch {
    // ignore and fall back
  }
  return [
    "gobble.com",
    "brilliantearth.com",
    "sunbasket.com",
    "homebrewsupply.com",
    "globalogistics.com",
    "sustainchem.com",
    "peakperform.com",
    "greenleafnursery.com",
  ];
}

function inferFromSupplier(s: string) {
  const x = s.toLowerCase();
  if (x.includes("stretch")) {
    return {
      persona: "Ops / Warehouse & Purchasing",
      keywords: ["rfp", "rfq", "packaging", "stretch", "pallet", "film"],
      platformFit: 0.5,
    };
  }
  if (x.includes("box") || x.includes("carton")) {
    return {
      persona: "E-com Ops & Packaging",
      keywords: ["boxes", "cartons", "mailer", "shipper", "rfp", "packaging"],
      platformFit: 0.5,
    };
  }
  return {
    persona: "Operations & Procurement",
    keywords: ["packaging", "supplies", "rfp", "rfq"],
    platformFit: 0.5,
  };
}

function makeLead(host: string, hot: boolean, why: Why[]): Lead {
  return {
    id: nextId++,
    host,
    platform: "unknown",
    title: `Lead: ${host}`,
    created_at: nowISO(),
    temperature: hot ? "hot" : "warm",
    why,
  };
}

// ---------- router ----------
export function mountLeads(app: Express): void {
  const r = Router();

  // GET /hot
  r.get("/hot", (req: Request, res: Response) => {
    const limit = clampInt(req.query.limit, 1, 500);
    const items = leads.filter((l) => l.temperature === "hot").slice(-limit).reverse();
    res.json({ ok: true, items });
  });

  // GET /warm
  r.get("/warm", (req: Request, res: Response) => {
    const limit = clampInt(req.query.limit, 1, 500);
    const items = leads.filter((l) => l.temperature === "warm").slice(-limit).reverse();
    res.json({ ok: true, items });
  });

  // GET /export.csv
  r.get("/export.csv", (req: Request, res: Response) => {
    const temp = (String(req.query.temperature || "hot").toLowerCase() as Temperature) || "hot";
    const limit = clampInt(req.query.limit, 1, 5000);
    const items = leads.filter((l) => l.temperature === temp).slice(-limit).reverse();

    const header = ["id", "host", "platform", "title", "created_at", "temperature"].join(",");
    const lines = items.map((l) =>
      [
        String(l.id).replace(/,/g, " "),
        l.host.replace(/,/g, " "),
        l.platform.replace(/,/g, " "),
        l.title.replace(/,/g, " "),
        l.created_at,
        l.temperature,
      ].join(","),
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${temp}_leads.csv"`);
    res.send([header, ...lines].join("\n"));
  });

  // PATCH /:id/stage
  r.patch("/:id/stage", (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });
    const id = req.params.id;
    const stage = String(req.body?.stage || "new") as Stage;
    stages.set(id, stage);
    res.json({ ok: true, leadId: toNum(id), stage });
  });

  // POST /:id/notes
  r.post("/:id/notes", (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });
    const id = req.params.id;
    const note = String(req.body?.note || "").trim();
    if (!note) return res.status(400).json({ ok: false, error: "note is required" });
    const arr = notes.get(id) || [];
    arr.push(`${new Date().toISOString()} — ${note}`);
    notes.set(id, arr);
    res.json({ ok: true, leadId: toNum(id) });
  });

  // POST /find-buyers
  r.post("/find-buyers", (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });

    const bodyRaw = req.body as Partial<FindBuyersBody> | undefined;
    const body: FindBuyersBody = {
      supplier: String(bodyRaw?.supplier || "").trim().toLowerCase(),
      region: String(bodyRaw?.region || "us").trim().toLowerCase(),
      radiusMi: Number(bodyRaw?.radiusMi ?? 50),
      limit: Number(bodyRaw?.limit ?? 50),
      keywords: Array.isArray(bodyRaw?.keywords) ? bodyRaw!.keywords : [],
    };

    if (!body.supplier) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    const inferred = inferFromSupplier(body.supplier);
    const seeds = readSeedsUSCA();

    const HOT_WORDS = ["rfp", "rfq", "bid", "tender", "quote", "mailer", "carton", "stretch", "film", "labels"];
    const kw = new Set((body.keywords || []).concat(inferred.keywords).map((s) => s.toLowerCase()));

    const items: Lead[] = [];
    for (const host of seeds) {
      if (items.length >= (body.limit || 50)) break;

      const h = host.toLowerCase();
      const hot =
        HOT_WORDS.some((w) => h.includes(w)) || Array.from(kw).some((w) => (w ? h.includes(w) : false));

      const dot = h.lastIndexOf(".");
      const tld = dot >= 0 ? h.slice(dot) : "";
      const domainScore = tld === ".com" ? 0.65 : tld === ".us" || tld === ".ca" ? 0.62 : 0.55;

      const why: Why[] = [
        score("meta", `${host} (${tld})`, domainScore),
        score("platform", "unknown", inferred.platformFit),
        score("persona", inferred.persona, 0.8),
        score("pmath", "catalog+shipping+returns (light check)", 0.7),
      ];

      items.push(makeLead(host, hot, why));
    }

    // merge to store so lists show immediately
    for (const l of items) leads.push(l);

    res.json({
      ok: true,
      supplier: body.supplier,
      region: body.region,
      radiusMi: body.radiusMi,
      items,
    });
  });

  // mount under /api/v1/leads
  app.use(BASE, r);
}
