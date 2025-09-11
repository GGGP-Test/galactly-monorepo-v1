import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";

// --------------------- types ---------------------
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
  supplier: string;          // domain like "stretchandshrink.com"
  region?: string;           // "us" | "ca" | "us-ca" | "City, ST"
  radiusMi?: number;         // e.g. 50
  limit?: number;            // max results
  keywords?: string[];       // optional, we don't require
}

// --------------------- in-memory store ---------------------
const leads: Lead[] = [];
const stages = new Map<string | number, Stage>();
const notes = new Map<string | number, string[]>();
let nextId = 1;

// --------------------- helpers ---------------------
function nowISO() {
  return new Date().toISOString();
}

function score(kind: Why["kind"], detail: string, value: number): Why {
  return { kind, detail, score: round2(value) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function readSeedsUSCA(): string[] {
  // Optional secret list; one domain per line. We only keep .com/.ca/.us and drop obvious non–US/CA TLDs.
  const guess = "/etc/secrets/seeds.txt";
  try {
    if (fs.existsSync(guess)) {
      const raw = fs.readFileSync(guess, "utf8");
      const all = raw
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      // crude US/CA filter by TLD and excluding obvious non–US/CA ccTLDs often seen in the seed
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

      return all.filter((d) => {
        const tld = d.slice(d.lastIndexOf("."));
        if (deny.has(tld)) return false;
        return (
          tld === ".com" ||
          tld === ".us" ||
          tld === ".ca" ||
          // keep unknown TLDs only if domain contains "-us" or "-ca" hint
          /(^|\W)(us|usa|ca|canada)(\W|$)/.test(d)
        );
      });
    }
  } catch {
    // ignore
  }
  // minimal fallback (kept US/CA friendly)
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

function inferFromSupplier(supplier: string) {
  const s = supplier.toLowerCase();
  // very light heuristics for persona + category (no external calls)
  // You can replace with your AI pipeline later.
  if (s.includes("stretch")) {
    return {
      persona: "Ops / Warehouse & Purchasing",
      keywords: ["rfp", "rfq", "packaging", "stretch", "pallet", "film"],
      platformFit: 0.5,
    };
  }
  if (s.includes("box") || s.includes("carton")) {
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

function requireApiKey(req: Request): string | null {
  const k = (req.headers["x-api-key"] || req.headers["X-API-Key"]) as string | undefined;
  return k && String(k).trim() ? String(k).trim() : null;
}

// --------------------- route mount ---------------------
export function mountLeads(app: Express, base = "/api/v1/leads") {
  // GET /hot
  app.get(path.join(base, "/hot"), (req: Request, res: Response) => {
    const limit = clampInt(String(req.query.limit || "50"), 1, 500);
    const items = leads
      .filter((l) => l.temperature === "hot")
      .slice(-limit)
      .reverse();
    res.json({ ok: true, items });
  });

  // GET /warm
  app.get(path.join(base, "/warm"), (req: Request, res: Response) => {
    const limit = clampInt(String(req.query.limit || "50"), 1, 500);
    const items = leads
      .filter((l) => l.temperature === "warm")
      .slice(-limit)
      .reverse();
    res.json({ ok: true, items });
  });

  // CSV export
  app.get(path.join(base, "/export.csv"), (req: Request, res: Response) => {
    const temp = (String(req.query.temperature || "hot").toLowerCase() as Temperature) || "hot";
    const limit = clampInt(String(req.query.limit || "500"), 1, 5000);
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
    const out = [header, ...lines].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${temp}_leads.csv"`);
    res.send(out);
  });

  // PATCH /:id/stage
  app.patch(path.join(base, "/:id/stage"), (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });
    const id = req.params.id;
    const stage = String(req.body?.stage || "new") as Stage;
    stages.set(id, stage);
    return res.json({ ok: true, leadId: toNum(id), stage });
  });

  // POST /:id/notes
  app.post(path.join(base, "/:id/notes"), (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });
    const id = req.params.id;
    const note = String(req.body?.note || "").trim();
    if (!note) return res.status(400).json({ ok: false, error: "note is required" });
    const arr = notes.get(id) || [];
    arr.push(`${new Date().toISOString()} — ${note}`);
    notes.set(id, arr);
    return res.json({ ok: true, leadId: toNum(id) });
  });

  // ----------------- POST /find-buyers (the one your panel calls) -----------------
  app.post(path.join(base, "/find-buyers"), (req: Request, res: Response) => {
    if (!requireApiKey(req)) return res.status(401).json({ ok: false, error: "missing x-api-key" });

    const body: FindBuyersBody = {
      supplier: String(req.body?.supplier || "").trim().toLowerCase(),
      region: String(req.body?.region || "us").trim().toLowerCase(),
      radiusMi: Number(req.body?.radiusMi || 50),
      limit: Number(req.body?.limit || 50),
      keywords: Array.isArray(req.body?.keywords) ? req.body.keywords : [],
    };

    if (!body.supplier) {
      return res.status(400).json({ ok: false, error: "supplier domain is required" });
    }

    // infer persona/keywords from supplier
    const inferred = inferFromSupplier(body.supplier);

    // pick seed domains (US/CA only)
    const seedDomains = readSeedsUSCA();

    // simple ranking:
    //  - HOT if host name contains any of ["rfp","rfq","bid","tender"] or matches any provided keywords
    //  - otherwise WARM
    //  - attach "why" chips (domain quality ~ .com/.us/.ca, persona match, packaging math placeholder)
    const HOT_WORDS = ["rfp", "rfq", "bid", "tender", "quote", "mailer", "carton", "stretch", "film", "labels"];
    const kw = new Set(
      (body.keywords || []).concat(inferred.keywords).map((s) => s.toLowerCase().trim()).filter(Boolean),
    );

    const out: Lead[] = [];
    for (const host of seedDomains) {
      if (out.length >= (body.limit || 50)) break;

      const h = host.toLowerCase();
      const hotHit = HOT_WORDS.some((w) => h.includes(w)) || Array.from(kw).some((w) => h.includes(w));

      const tld = h.slice(h.lastIndexOf("."));
      const domainScore = tld === ".com" ? 0.65 : tld === ".us" || tld === ".ca" ? 0.62 : 0.55;

      const why: Why[] = [
        score("meta", `${host} (${tld})`, domainScore),
        score("platform", "unknown", inferred.platformFit),
        score("persona", inferred.persona, 0.8),
        score("pmath", "catalog+shipping+returns (light check)", 0.7),
      ];

      out.push(makeLead(host, hotHit, why));
    }

    // merge into store so they appear in hot/warm lists right away
    for (const l of out) {
      leads.push(l);
    }

    res.json({
      ok: true,
      supplier: body.supplier,
      region: body.region,
      radiusMi: body.radiusMi,
      items: out,
    });
  });
}

// --------------------- small utils ---------------------
function toNum(id: string | number): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : nextId++;
}

function clampInt(s: string, min: number, max: number): number {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
