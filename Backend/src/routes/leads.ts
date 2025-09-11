// Backend/src/routes/leads.ts
import type { Express, Request, Response } from "express";
import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireApiKey } from "../auth";

// ---------- Types ----------
type Temp = "hot" | "warm";
type WhyKind = "meta" | "platform" | "signal";

interface WhyItem {
  label: string;
  kind: WhyKind;
  score: number;
  detail: string;
}

interface Lead {
  id: number;
  host: string;
  platform: string; // "shopify" | "woocommerce" | "unknown"
  cat: string;      // "product" | "service" | etc
  title: string;
  created_at: string; // ISO
  temperature: Temp;
  why: WhyItem[];
}

interface FindPayload {
  supplierDomain: string;
  keywords?: string;
  personas?: string;
  regions?: string;
  industries?: string;
  limit?: number;
}

// ---------- In-memory store ----------
const leads: Lead[] = [];
let nextId = 1;

// Remember quick notes / stages (in-memory)
const stages = new Map<number, string>();
const notes  = new Map<number, string[]>();

// ---------- Helpers ----------
const SEED_FILE = process.env.SEED_FILE || "/etc/secrets/seeds.txt";

function nowIso(): string { return new Date().toISOString(); }

function normalizeHost(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  // Remove accidental label fragments like "läderach usa,https:"
  s = s.replace(/[,\s]+https?:.*/g, "");
  // Strip protocol and path
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  // Drop trailing commas or stray punctuation
  s = s.replace(/[,\s]+$/g, "");
  // Keep only last two/three labels to get domain.tld
  const parts = s.split(".").filter(Boolean);
  if (parts.length >= 3) {
    const last = parts.slice(-3).join(".");
    const last2 = parts.slice(-2).join(".");
    // Preserve 2 or 3 labels depending on ccTLD heuristics
    if (/\.(co|com|org|net|gov)\.[a-z]{2}$/.test(last)) return last;
    return last2;
  }
  return s;
}

function domainQuality(host: string): number {
  if (!host) return 0.4;
  if (host.endsWith(".com")) return 0.65;
  if (/\.(co|org|net|io|ai)$/i.test(host)) return 0.58;
  return 0.5;
}

function guessPlatform(host: string): string {
  if (/myshopify\.com$/.test(host) || /shopify/.test(host)) return "shopify";
  if (/wp\./.test(host) || /woocommerce/.test(host)) return "woocommerce";
  return "unknown";
}

function kwToList(s?: string): string[] {
  if (!s) return [];
  return s.split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
}

function temperatureFromKeywords(kws: string[]): Temp {
  // Treat explicit purchase intent as hot
  if (kws.some(k => /^(rfp|rfq|tender|proposal|bids?)$/.test(k))) return "hot";
  return "warm";
}

function scoreSignal(base: number, ...extras: number[]): number {
  let v = base;
  for (const e of extras) v += e;
  return Math.max(0, Math.min(1, v));
}

function existsHost(host: string): boolean {
  return leads.some(l => l.host === host);
}

function addLead(l: Omit<Lead, "id" | "created_at">): Lead {
  const lead: Lead = { id: nextId++, created_at: nowIso(), ...l };
  leads.unshift(lead);
  return lead;
}

function readSeeds(): string[] {
  try {
    const raw = fs.readFileSync(SEED_FILE, "utf8");
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Clean each entry to just host
    return lines.map(normalizeHost).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------- Router ----------
export function mountLeads(app: Express) {
  const r = Router();

  // HEALTH (index.ts should also expose /healthz, this is just a tiny noop)
  r.get("/ping", (_req, res) => res.json({ ok: true, pong: true, time: nowIso() }));

  // LISTS
  r.get("/hot", (req, res) => {
    const limit = Number(req.query.limit || 50);
    const items = leads.filter(l => l.temperature === "hot").slice(0, limit);
    res.json({ ok: true, items });
  });

  r.get("/warm", (req, res) => {
    const limit = Number(req.query.limit || 50);
    const items = leads.filter(l => l.temperature === "warm").slice(0, limit);
    res.json({ ok: true, items });
  });

  // ONE
  r.get("/:id", (req, res) => {
    const id = Number(req.params.id);
    const item = leads.find(l => l.id === id);
    if (!item) return res.json({ ok: false, error: "bad id" });
    res.json({
      ok: true,
      temperature: item.temperature,
      lead: item,
      why: item.why
    });
  });

  // EXPORT CSV
  r.get("/export.csv", (req, res) => {
    const limit = Number(req.query.limit || 100);
    const temp = String(req.query.temperature || "").toLowerCase() as Temp | "";
    let items = leads.slice();
    if (temp === "hot" || temp === "warm") items = items.filter(l => l.temperature === temp);
    items = items.slice(0, limit);
    const rows = [
      "id,host,platform,cat,title,created_at,temperature",
      ...items.map(l => [
        JSON.stringify(String(l.id)),
        JSON.stringify(l.host),
        JSON.stringify(l.platform),
        JSON.stringify(l.cat || "product"),
        JSON.stringify(l.title || ""),
        JSON.stringify(new Date(l.created_at).toString()),
        JSON.stringify(l.temperature)
      ].join(","))
    ];
    const csv = rows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);
  });

  // STAGE + NOTE (require API key)
  r.patch("/:id/stage", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const stage = String((req.body?.stage || "new")).trim();
    if (!leads.some(l => l.id === id)) return res.json({ ok: false, error: "bad id" });
    stages.set(id, stage);
    res.json({ ok: true, leadId: id, stage });
  });

  r.post("/:id/notes", requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!leads.some(l => l.id === id)) return res.json({ ok: false, error: "bad id" });
    const note = String(req.body?.note || "").trim();
    if (!note) return res.json({ ok: false, error: "empty note" });
    const arr = notes.get(id) || [];
    arr.push(`${nowIso()} — ${note}`);
    notes.set(id, arr);
    res.json({ ok: true, leadId: id });
  });

  // FIND buyers from supplier
  r.post("/find", requireApiKey, (req: Request<unknown, unknown, FindPayload>, res: Response) => {
    const body = req.body || {} as FindPayload;
    const supplierRaw = String(body.supplierDomain || "").trim();
    const supplierDomain = normalizeHost(supplierRaw);

    if (!supplierDomain) {
      return res.status(400).json({ ok: false, error: "supplierDomain required" });
    }

    const limit = Math.max(1, Math.min(100, Number(body.limit || 12)));
    const seedHosts = readSeeds();

    // Inputs as keyword lists (used as signals)
    const kw      = kwToList(body.keywords);
    const personas= kwToList(body.personas);
    const regions = kwToList(body.regions);
    const inds    = kwToList(body.industries);

    // Compute a simple intent temperature from keywords (rfp/rfq => hot)
    const intentTemp: Temp = temperatureFromKeywords(kw);

    // Very simple candidate generation:
    // - start from seeds list (buyer domains)
    // - filter out supplier itself
    // - prefer domains whose slug contains any provided keywords/regions/industries (as heuristics)
    const pref = new Set([...kw, ...regions, ...inds]);
    const scored: {host: string; score: number; why: WhyItem[]}[] = [];

    for (const hostRaw of seedHosts) {
      const host = normalizeHost(hostRaw);
      if (!host || host === supplierDomain) continue;

      // Base meta score
      const metaScore = domainQuality(host);

      // Signal boosts: if host includes any preference tokens
      let boost = 0;
      const lower = host.toLowerCase();
      for (const token of pref) {
        if (token && lower.includes(token)) boost += 0.05;
      }
      // Personas are used as a tiny extra nudge (we don't know staff emails yet)
      if (personas.length) boost += 0.02;

      // Platform is unknown at this stage
      const why: WhyItem[] = [
        { label: "Domain quality", kind: "meta", score: metaScore, detail: `${host} (${path.extname("x."+host).slice(1)})` },
        { label: "Platform fit",   kind: "platform", score: 0.50, detail: "unknown" },
        { label: "Intent keywords",kind: "signal", score: kw.length ? 0.80 : 0.60, detail: (kw.join(", ") || "— no strong keywords") }
      ];

      const total = scoreSignal(metaScore, boost);
      scored.push({ host, score: total, why });
    }

    // Sort by score desc and take limit
    scored.sort((a,b) => b.score - a.score);
    const pick = scored.slice(0, limit);

    const createdIds: number[] = [];
    let skipped = 0;

    for (const c of pick) {
      if (existsHost(c.host)) { skipped++; continue; }
      const l = addLead({
        host: c.host,
        platform: guessPlatform(c.host),
        cat: "product",
        title: `Lead: ${c.host}`,
        temperature: intentTemp,
        why: c.why
      });
      createdIds.push(l.id);
    }

    res.json({
      ok: true,
      supplierDomain,
      created: createdIds.length,
      ids: createdIds,
      skipped,
      errors: 0,
      temperature: intentTemp
    });
  });

  app.use("/api/v1/leads", r);
}
