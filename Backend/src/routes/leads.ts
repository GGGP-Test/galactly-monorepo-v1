// Backend/src/routes/leads.ts
import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Simple in-memory store. Northflank restarts will clear this —
 * which is fine for the free panel and for incremental testing.
 */
type Temperature = "hot" | "warm";
type WhyItem = { label: string; text: string; score?: number };
type Persona = { title: string; summary: string; roles: string[] };

export type LeadRow = {
  id: number;
  host: string;
  platform: string;
  title: string;
  created_at: string; // ISO
  temperature: Temperature;
  why: WhyItem[];
  persona?: Persona;
};

const LEADS: LeadRow[] = [];
let NEXT_ID = 1;

/* -------------------------- utilities (no deps) -------------------------- */

function nowISO() {
  return new Date().toISOString();
}

function normalizeHost(input: string): string {
  let x = input.trim();
  if (x.startsWith("http://") || x.startsWith("https://")) {
    try {
      const u = new URL(x);
      x = u.hostname;
    } catch {}
  }
  // drop starting www.
  x = x.replace(/^www\./i, "");
  return x.toLowerCase();
}

function onlyUSCA(host: string, regionHint?: string): boolean {
  const tld = (host.split(".").pop() || "").toLowerCase();
  if (regionHint && regionHint.toLowerCase() === "ca") return tld === "ca";
  if (regionHint && regionHint.toLowerCase() === "us") {
    // allow common US TLDs
    return tld === "com" || tld === "us" || tld === "net" || tld === "org";
  }
  // default: US/CA only
  return tld === "ca" || tld === "com" || tld === "us" || tld === "net" || tld === "org";
}

function sha(x: string) {
  return crypto.createHash("sha1").update(x).digest("hex");
}

async function fetchHTML(host: string): Promise<string> {
  const url = `https://${host}`;
  const g: any = globalThis as any;
  const fetchFn: any = (g && g.fetch) ? g.fetch : null;
  if (!fetchFn) return "";
  try {
    const r = await fetchFn(url, { redirect: "follow" });
    if (!r || !r.text) return "";
    const t = await r.text();
    return typeof t === "string" ? t : "";
  } catch {
    return "";
  }
}

/* -------------------------- lightweight detectors ----------------------- */

function detectPlatform(html: string): string {
  const h = html;
  if (/(cdn\.shopify\.com|x-shopify|Shopify\.theme|\/cart\.js)/i.test(h)) return "shopify";
  if (/(woocommerce|wp-content\/plugins\/woocommerce|wc-add-to-cart)/i.test(h)) return "woocommerce";
  if (/(bigcommerce|stencil-bootstrap|cdn\.bcapp)/i.test(h)) return "bigcommerce";
  if (/(squarespace|Static\.sqs-assets)/i.test(h)) return "squarespace";
  if (/(wix-code|wix-static|wix\.apps|wixBiSession)/i.test(h)) return "wix";
  if (/(webflow\.io|data-wf-site|webflow\.js)/i.test(h)) return "webflow";
  return "unknown";
}

type PWhy =
  | { label: "They sell physical products"; detail: string; score: number }
  | { label: "Has cart / checkout"; detail: string; score: number }
  | { label: "Shipping & returns policy"; detail: string; score: number }
  | { label: "Product schema detected"; detail: string; score: number }
  | { label: "Recent activity"; detail: string; score: number };

function packagingMath(html: string): { score: number; parts: PWhy[] } {
  const h = html;
  const parts: PWhy[] = [];

  // Physical products
  if (/(add to cart|add-to-cart|buy now|in stock|sku)/i.test(h)) {
    parts.push({
      label: "They sell physical products",
      detail: "Found “Add to cart/Buy now/SKU” markers.",
      score: 0.25,
    });
  }
  // Cart/checkout
  if (/(\/cart|cart\.js|checkout)/i.test(h)) {
    parts.push({
      label: "Has cart / checkout",
      detail: "Cart or checkout endpoints present.",
      score: 0.20,
    });
  }
  // Policies
  if (/(shipping|delivery|returns|return policy)/i.test(h)) {
    parts.push({
      label: "Shipping & returns policy",
      detail: "Policy pages mention shipping/returns.",
      score: 0.20,
    });
  }
  // Product schema
  if (/"@type"\s*:\s*"(Product|Offer)"/i.test(h)) {
    parts.push({
      label: "Product schema detected",
      detail: "Structured data has Product/Offer.",
      score: 0.20,
    });
  }
  // Activity
  if (/(new arrivals|just in|new collection)/i.test(h)) {
    parts.push({
      label: "Recent activity",
      detail: "Mentions “New arrivals/Just in”.",
      score: 0.15,
    });
  }

  let score = 0;
  for (const p of parts) score += p.score;
  if (score > 1) score = 1;
  return { score, parts };
}

function detectAdSignals(html: string): string[] {
  const h = html;
  const out: string[] = [];
  if (/googleads\.g\.doubleclick\.net|AW-\d/i.test(h)) out.push("Google Ads");
  if (/facebook\.net\/en_US\/fbevents\.js|fbq\(/i.test(h)) out.push("Meta Pixel");
  if (/tiktok\.com\/i18n\/pixel|ttq\.track/i.test(h)) out.push("TikTok Pixel");
  if (/snap\.licdn\.com\/li_lms|linkedin/i.test(h)) out.push("LinkedIn Insight");
  return out;
}

function intentKeywords(text: string): { keywords: string[]; score: number } {
  const terms = ["rfp", "rfq", "tender", "request for proposal", "request for quote", "co-packer", "3pl", "packaging supplier"];
  const hits: string[] = [];
  for (const t of terms) {
    const re = new RegExp("\\b" + t.replace(/\s+/g, "\\s+") + "\\b", "i");
    if (re.test(text)) hits.push(t);
  }
  let s = hits.length * 0.25;
  if (s > 1) s = 1;
  return { keywords: hits, score: s };
}

async function enrich(host: string): Promise<Pick<LeadRow, "platform" | "why" | "temperature" | "persona">> {
  const html = await fetchHTML(host);
  const platform = detectPlatform(html);
  const pm = packagingMath(html);
  const ads = detectAdSignals(html);
  const ik = intentKeywords(html);

  const tld = (host.split(".").pop() || "").toLowerCase();
  const tldScore = (tld === "com" || tld === "ca" || tld === "net" || tld === "org" || tld === "us") ? 0.65 : 0.4;

  const why: WhyItem[] = [
    { label: "Domain quality", text: `${host} (.${tld}) — decent domain.`, score: tldScore },
    { label: "Platform fit", text: platform === "unknown" ? "Platform unknown" : `Runs on ${platform}.`, score: platform === "unknown" ? 0.5 : 0.75 },
    { label: "They likely buy packaging", text: pm.parts.map(p => p.label).join("; "), score: pm.score },
  ];

  if (ads.length) {
    why.push({ label: "Growth signals", text: `Pixels detected: ${ads.join(", ")}.`, score: 0.6 });
  }
  if (ik.keywords.length) {
    const s = ik.score > 0.7 ? ik.score : 0.7;
    why.push({ label: "Intent keywords", text: ik.keywords.join(", "), score: s });
  }

  const persona: Persona = {
    title: "Purchasing / Ops / Warehouse Manager",
    summary:
      "Based on products and operations signals, best first contact is Purchasing Manager, Operations Manager, or Warehouse Manager.",
    roles: ["Purchasing Manager", "Operations Manager", "Warehouse Manager"],
  };

  const hot = ik.keywords.length > 0 || pm.score >= 0.8 || (pm.score >= 0.6 && ads.length > 0);

  return {
    platform,
    why,
    temperature: hot ? "hot" : "warm",
    persona,
  };
}

/* -------------------------- seeds loader (US/CA only) -------------------- */

function readSeeds(): string[] {
  // Allow both absolute (Northflank secret mount) and repo local during dev
  const candidates = [
    "/etc/secrets/seeds.txt",
    "/etc/secrets/seed.txt",
    path.join(process.cwd(), "seeds.txt"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const hosts: string[] = [];
        for (const line of lines) {
          // extract first domain-like token
          const m = line.match(/([a-z0-9.-]+\.[a-z]{2,})/i);
          if (m && m[1]) hosts.push(normalizeHost(m[1]));
        }
        return hosts;
      }
    } catch {}
  }
  // Fallback minimal demo list (US/CA style TLDs to pass filter)
  return [
    "brightearth.com",
    "sunbasket.com",
    "homebrewsupply.com",
    "globallogistics.com",
    "peakperform.com",
    "greentrails.ca",
  ].map(normalizeHost);
}

/* -------------------------- API key (write actions) ---------------------- */

function requireApiKey(req: Request, res: Response, next: Function) {
  const need = process.env.API_KEY || process.env.ADMIN_KEY || process.env.APP_KEY || "";
  if (!need) return next(); // nothing configured -> allow (free panel)
  const got = String(req.header("x-api-key") || "");
  if (got && got === need) return next();
  res.status(401).json({ ok: false, error: "missing_or_invalid_api_key" });
}

/* -------------------------- CSV helpers ---------------------------------- */

function toCSV(rows: LeadRow[]) {
  const header = ["id","host","platform","title","created_at","temperature","why"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const why = r.why.map(w => `${w.label}:${w.text}`).join(" | ");
    const line = [
      r.id,
      r.host,
      r.platform,
      r.title.replace(/,/g, " "),
      r.created_at,
      r.temperature,
      why.replace(/,/g, " "),
    ].join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

/* -------------------------- public endpoints ----------------------------- */

async function listByTemp(temp: Temperature, limit: number): Promise<LeadRow[]> {
  const rows = LEADS.filter(x => x.temperature === temp)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows.slice(0, limit);
}

async function handleFind(req: Request, res: Response) {
  const body = (req.body && typeof req.body === "object") ? req.body as any : {};
  const supplierDomain = normalizeHost(String(body.supplier || body.domain || body.host || ""));
  const region = String(body.region || "us").toLowerCase();
  const radius = Number(body.radiusMi || body.radius || 50);

  if (!supplierDomain) {
    return res.status(400).json({ ok: false, error: "missing_supplier_domain" });
  }

  const seeds = readSeeds().filter(h => onlyUSCA(h, region));
  // If the seed list includes the supplier itself, skip it
  const uniq = new Set<string>();
  const candidates: string[] = [];
  for (const h of seeds) {
    if (h === supplierDomain) continue;
    if (!uniq.has(h)) {
      uniq.add(h);
      candidates.push(h);
    }
    if (candidates.length >= 60) break; // keep it snappy
  }

  // Enrich in parallel with soft timeouts
  const withMeta: LeadRow[] = [];
  const tasks = candidates.map(async (host) => {
    const rich = await enrich(host);
    const row: LeadRow = {
      id: NEXT_ID++,
      host,
      platform: rich.platform,
      title: `Lead: ${host}`,
      created_at: nowISO(),
      temperature: rich.temperature,
      why: rich.why,
      persona: rich.persona,
    };
    withMeta.push(row);
    LEADS.push(row);
  });

  // Wait with a hard cap (10s)
  await Promise.race([
    Promise.allSettled(tasks),
    new Promise((r) => setTimeout(r, 10000)),
  ]);

  // Basic “proximity” simulation: currently unused, but we accept and echo it
  const meta = { region, radiusMi: radius };

  const hotN = withMeta.filter(r => r.temperature === "hot").length;
  const warmN = withMeta.filter(r => r.temperature === "warm").length;
  res.json({
    ok: true,
    meta,
    created: withMeta.length,
    hot: hotN,
    warm: warmN,
  });
}

/* -------------------------- route mount ---------------------------------- */

export function mountLeads(app: Express) {
  const base = "/api/v1/leads";

  // Health probe used by Northflank
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  // LIST
  app.get(`${base}/hot`, async (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const out = await listByTemp("hot", limit);
    res.json({ ok: true, items: out });
  });

  app.get(`${base}/warm`, async (req, res) => {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const out = await listByTemp("warm", limit);
    res.json({ ok: true, items: out });
  });

  // FIND buyers from a supplier (write-ish action)
  app.post(`${base}/find`, requireApiKey, handleFind);

  // Simple stage setter (kept for curl compatibility)
  app.patch(`${base}/:id/stage`, requireApiKey, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const stage = String((req.body as any)?.stage || "").toLowerCase();
    const row = LEADS.find(r => r.id === id);
    if (!row) return res.status(404).json({ ok: false, error: "not_found" });
    // Store as a why-note so user can see it in panel
    row.why.push({ label: "Stage", text: stage });
    res.json({ ok: true, leadId: id, stage });
  });

  // CSV
  app.get(`${base}/hot.csv`, async (_req, res) => {
    const out = await listByTemp("hot", 500);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(toCSV(out));
  });
  app.get(`${base}/warm.csv`, async (_req, res) => {
    const out = await listByTemp("warm", 500);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(toCSV(out));
  });
}

// Export default **and** named (fixes “no exported member mountLeads”)
export default function mountLeadsDefault(app: Express) {
  return mountLeads(app);
}
