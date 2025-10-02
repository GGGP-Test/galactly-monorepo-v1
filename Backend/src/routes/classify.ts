// src/routes/classify.ts
//
// Deep classifier (crawler + extractor + summarizer)
// --------------------------------------------------
// GET  /api/classify?host=acme.com[&maxPages=8][&mode=deep|fast]
// POST /api/classify  { host, maxPages?, mode? }
//
// Returns:
// {
//   ok: true,
//   host, role, confidence,
//   summary,
//   productTags: string[],
//   sectorHints: string[],
//   hotMetricsBySector: Record<string,string[]>,
//   geoHints: { citiesTop: string[], statesTop: string[] },
//   bytes, fetchedAt, cached
// }

import { Router, Request, Response } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

import { spiderHost } from "../shared/spider";
import { extractProducts, extractSectors, metricsBySector } from "../shared/extractor";
import { buildOneLiner, type Role } from "../shared/summarizer";

const r = Router();

// Node 20 global fetch typing (minimal)
type FetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
  json(): Promise<any>;
};
const F: (u: string, init?: any) => Promise<FetchResponse> = (globalThis as any).fetch;

function normHost(raw?: string): string | undefined {
  if (!raw) return;
  const h = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : undefined;
}

function roleFromSignals(text: string): { role: Role; confidence: number; evidence: string[] } {
  const t = (text || "").toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "cart", "sku"];
  const packagingTokens = [
    "packaging","box","boxes","carton","cartons","corrugate","corrugated",
    "label","labels","tape","pouch","pouches","bottle","bottles","jar","jars",
    "mailers","mailer","film","shrink","pallet","pallets","closure","closures","cap","caps","stretch"
  ];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "supply", "wholesale", "distributor", "converter", "co-pack", "contract pack", "private label"];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy  = contains(buyerHints);
  const sup  = contains(supplierVerbs);

  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer    = buy + (prod > 0 ? 1 : 0);

  const evidence: string[] = [];
  if (prod) evidence.push(`product_signals:${prod}`);
  if (pack) evidence.push(`packaging_terms:${pack}`);
  if (sup)  evidence.push(`supplier_verbs:${sup}`);
  if (buy)  evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2)
    return { role: "packaging_supplier", confidence: Math.min(1, 0.6 + 0.08 * scoreSupplier), evidence };
  if (scoreBuyer >= 2)
    return { role: "packaging_buyer", confidence: Math.min(1, 0.6 + 0.08 * scoreBuyer), evidence };
  return { role: "neither", confidence: 0.35, evidence };
}

// City/State extraction (very light)
const US_ST_FULL = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];

function extractGeoHints(text: string): { citiesTop: string[]; statesTop: string[] } {
  const t = text || "";
  const cities = new Map<string, number>();
  const states = new Map<string, number>();

  const reCitySt = /\b([A-Z][A-Za-z .'-]{2,}?),\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/g;
  let m: RegExpExecArray | null;
  while ((m = reCitySt.exec(t))) {
    const city = m[1].trim();
    const st = m[2].trim();
    cities.set(city, (cities.get(city) || 0) + 2);
    states.set(st, (states.get(st) || 0) + 2);
  }

  const reCityState = new RegExp(`\\b([A-Z][A-Za-z .'-]{2,}?),\\s*(${US_ST_FULL.join("|")})\\b`, "g");
  let n: RegExpExecArray | null;
  while ((n = reCityState.exec(t))) {
    const city = n[1].trim();
    const st = n[2].trim();
    cities.set(city, (cities.get(city) || 0) + 1);
    states.set(st, (states.get(st) || 0) + 1);
  }

  const citiesTop = Array.from(cities.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  const statesTop = Array.from(states.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
  return { citiesTop, statesTop };
}

// ---- core classify ---------------------------------------------------------
async function classifyHost(host: string, maxPages: number, mode: "deep" | "fast" = "deep") {
  const crawl = await spiderHost(host, {
    maxPages: Math.min(Math.max(3, maxPages || 0), 16),
    maxBytes: Math.max(1_000_000, CFG.maxFetchBytes || 1_500_000),
    timeoutMs: Math.max(5000, CFG.fetchTimeoutMs || 7000),
    // optional: could add allowPatterns/denyPatterns later
  });

  const text = String((crawl as any).text || "");
  const title = String((crawl as any).title || "");
  const description = String((crawl as any).description || "");
  const keywords: string[] = ((crawl as any).keywords || []) as string[];
  const bytes = Number((crawl as any).bytes || 0);

  const roleGuess = roleFromSignals(text + " " + title + " " + description);

  // Bottom-up extraction
  const productTags = extractProducts(text, keywords);
  const sectorHints = extractSectors(text, keywords);
  const hotMetricsBySector = metricsBySector(text, sectorHints, productTags);

  const geoHints = extractGeoHints(text);

  const summary = buildOneLiner(
    host,
    roleGuess.role,
    productTags,
    sectorHints,
    { style: mode === "deep" ? "rich" : "normal" }
  );

  return {
    ok: true,
    host,
    role: roleGuess.role,
    confidence: roleGuess.confidence,
    summary,
    productTags,
    sectorHints,
    evidence: roleGuess.evidence,
    hotMetricsBySector,
    geoHints,
    bytes,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

// ---- routes ----------------------------------------------------------------
r.get("/", async (req: Request, res: Response) => {
  try {
    const host = normHost(String(req.query.host || ""));
    if (!host) return res.status(404).json({ ok: false, error: "bad_host", detail: "Missing or invalid host" });

    const capKey = `classify:${(req.ip || req.socket.remoteAddress || "ip")}`;
    const limit = CFG.classifyDailyLimit || 20;
    if ((daily.get(capKey) || 0) >= limit) {
      return res.status(200).json({ ok: false, error: "quota", remaining: 0 });
    }

    const maxPages = Number(req.query.maxPages ?? 8) || 8;
    const mode = (String(req.query.mode || "deep").toLowerCase() === "fast" ? "fast" : "deep") as "deep" | "fast";

    const key = `classify:${host}:${mode}:${maxPages}`;
    const result = await withCache(
      key,
      (CFG.classifyCacheTtlS || (24 * 3600)) * 1000,
      () => classifyHost(host, maxPages, mode)
    );

    if (typeof daily.inc === "function") daily.inc(capKey, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    const friendly =
      /too[- ]large|maxBytes/i.test(msg) ? "site too large" :
      /blocked|403|401|status\s+4\d\d/i.test(msg) ? "blocked or not found" :
      /aborted|timeout|network/i.test(msg) ? "network error while reading your site." :
      msg;
    return res.status(200).json({ ok: false, error: "classify-failed", detail: friendly });
  }
});

r.post("/", async (req: Request, res: Response) => {
  try {
    const body = (req.body || {}) as { host?: string; maxPages?: number; mode?: "deep" | "fast" };
    const host = normHost(body.host);
    if (!host) return res.status(404).json({ ok: false, error: "bad_host" });

    const capKey = `classify:${(req.ip || req.socket.remoteAddress || "ip")}`;
    const limit = CFG.classifyDailyLimit || 20;
    if ((daily.get(capKey) || 0) >= limit) {
      return res.status(200).json({ ok: false, error: "quota", remaining: 0 });
    }

    const maxPages = Number(body.maxPages ?? 8) || 8;
    const mode = (body.mode === "fast" ? "fast" : "deep") as "deep" | "fast";

    const key = `classify:${host}:${mode}:${maxPages}`;
    const result = await withCache(
      key,
      (CFG.classifyCacheTtlS || (24 * 3600)) * 1000,
      () => classifyHost(host, maxPages, mode)
    );

    if (typeof daily.inc === "function") daily.inc(capKey, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;