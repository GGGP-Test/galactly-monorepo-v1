// src/routes/classify.ts
//
// Domain classifier with guardrails + caching + lightweight enrichment.
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }
//
// Returns (success):
//   {
//     ok: true,
//     host, role, confidence, summary,
//     productTags: string[],
//     sectorHints: string[],
//     evidence: string[],
//     bytes, fetchedAt, cached
//   }
//
// No DOM typings required; we define a minimal fetch Response interface.

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

// ---- minimal fetch typing (Node 20) -----------------------------------------
type FetchResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<any>;
};
const F: (input: string, init?: any) => Promise<FetchResponse> = (globalThis as any).fetch;

const r = Router();

// ---- helpers ----------------------------------------------------------------
function normalizeHost(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const h = String(raw).trim().toLowerCase();
    const clean = h.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!clean || !/^[a-z0-9.-]+$/.test(clean)) return undefined;
    return clean;
  } catch {
    return undefined;
  }
}

function emailsDomain(email?: string): string | undefined {
  if (!email) return undefined;
  const m = String(email).toLowerCase().match(/@([a-z0-9.-]+)/);
  return m?.[1];
}

function clientKey(req: Request): string {
  const apiKey = (req.headers["x-api-key"] || "") as string;
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  return apiKey ? `k:${apiKey}` : `ip:${ip}`;
}

async function timedFetch(url: string, timeoutMs: number): Promise<FetchResponse> {
  const ctl = new (globalThis as any).AbortController();
  const t = setTimeout(() => ctl.abort(), Math.max(100, timeoutMs));
  try {
    return await F(url, { signal: ctl.signal, redirect: "follow" });
  } finally {
    clearTimeout(t as any);
  }
}

async function fetchHomepage(host: string): Promise<{ body: string; bytes: number; finalUrl: string }> {
  const urls = [`https://${host}/`, `http://${host}/`];
  let lastErr: unknown;
  for (const u of urls) {
    try {
      const res = await timedFetch(u, CFG.fetchTimeoutMs);
      if (!res.ok) {
        lastErr = new Error(`status ${res.status}`);
        continue;
      }
      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength;
      if (bytes > CFG.maxFetchBytes) throw new Error(`too-large:${bytes}`);
      const body = new TextDecoder("utf-8").decode(buf);
      return { body, bytes, finalUrl: res.url || u };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch-failed");
}

// very light HTML -> text + JSON-LD + key meta
function extractTextMeta(html: string): {
  text: string;
  jsonld: string[];
  title?: string;
  description?: string;
  keywords?: string[];
} {
  const meta: Record<string, string> = {};
  // <meta name="..." content="..."> and property="og:..."
  const reMeta = /<meta\s+[^>]*?(?:name|property)\s*=\s*["']([^"']+)["'][^>]*?content\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = reMeta.exec(html))) {
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    meta[k] = meta[k] || v;
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();

  const description = meta["description"] || meta["og:description"] || undefined;

  const keywordsRaw = meta["keywords"];
  const keywords =
    keywordsRaw?.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean) || undefined;

  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200000)
    .trim();

  const jsonld: string[] = [];
  const reLD = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let ml: RegExpExecArray | null;
  while ((ml = reLD.exec(html))) {
    const payload = ml[1]?.trim();
    if (payload) jsonld.push(payload);
  }

  return { text, jsonld, title, description, keywords };
}

// ---- rule classification (kept simple + deterministic) ----------------------
type Role = "packaging_supplier" | "packaging_buyer" | "neither";

function ruleClassify(text: string, jsonld: string[]): {
  role: Role;
  confidence: number;
  evidence: string[];
} {
  const t = text.toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "cart", "sku"];
  const packagingTokens = [
    "packaging",
    "box",
    "boxes",
    "carton",
    "corrugate",
    "label",
    "labels",
    "tape",
    "pouch",
    "pouches",
    "bottle",
    "bottles",
    "jar",
    "jars",
    "mailers",
    "cartons"
  ];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "supply", "wholesale", "distributor", "converter", "co-pack", "contract pack", "private label"];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy = contains(buyerHints);
  const sup = contains(supplierVerbs);

  // Simple scoring
  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer = buy + (prod > 0 ? 1 : 0);

  // JSON-LD nudges
  for (const raw of jsonld) {
    try {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        const ttype = (o && (o["@type"] || o.type)) || "";
        const s = typeof ttype === "string" ? ttype.toLowerCase() : "";
        if (s.includes("wholesalestore") || s.includes("manufacturer") || s.includes("organization")) scoreSupplier += 1;
        if (s.includes("store") || s.includes("localbusiness") || s.includes("brand")) scoreBuyer += 1;
      }
    } catch {
      /* ignore */
    }
  }

  const evidence: string[] = [];
  if (prod) evidence.push(`product_signals:${prod}`);
  if (pack) evidence.push(`packaging_terms:${pack}`);
  if (sup) evidence.push(`supplier_verbs:${sup}`);
  if (buy) evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2)
    return { role: "packaging_supplier", confidence: Math.min(1, 0.55 + 0.1 * scoreSupplier), evidence };
  if (scoreBuyer >= 2)
    return { role: "packaging_buyer", confidence: Math.min(1, 0.55 + 0.1 * scoreBuyer), evidence };
  return { role: "neither", confidence: 0.35, evidence };
}

// ---- enrichment lexicons ----------------------------------------------------
const PRODUCT_LEX: Record<string, string[]> = {
  boxes: ["box", "boxes", "carton", "cartons", "rigid box", "corrugated", "mailer box"],
  labels: ["label", "labels", "sticker", "stickers"],
  cartons: ["carton", "cartons", "folding carton"],
  pouches: ["pouch", "pouches", "stand up pouch", "stand-up pouch", "mylar"],
  bottles: ["bottle", "bottles", "vial", "vials"],
  jars: ["jar", "jars", "tin", "tins"],
  tape: ["tape", "packaging tape"],
  corrugate: ["corrugate", "corrugated"],
  mailers: ["mailer", "mailers", "poly mailer"],
  clamshells: ["clamshell", "clamshells", "blister"],
  foam: ["foam insert", "foam", "eva foam"],
  pallets: ["pallet", "pallets", "palletizing"],
  mailer_bags: ["bag", "bags", "polybag", "poly bag"],
  shrink: ["shrink", "shrink wrap", "shrink film"],
  film: ["film", "flexible film", "laminate", "laminated film"],
};

const SECTOR_LEX: Record<string, string[]> = {
  food: ["food", "grocery", "snack", "sauce", "salsa", "candy", "baked"],
  beverage: ["beverage", "drink", "juice", "soda", "coffee", "tea", "brewery", "beer", "wine"],
  cosmetics: ["cosmetic", "cosmetics", "beauty", "skincare", "skin care", "haircare", "makeup"],
  supplements: ["supplement", "nutraceutical", "vitamin", "sports nutrition"],
  electronics: ["electronics", "devices", "gadgets"],
  apparel: ["apparel", "fashion", "clothing", "garment"],
  pharma: ["pharma", "pharmaceutical", "medical", "medication", "rx"],
  pet: ["pet", "pets", "petcare", "pet care"],
  automotive: ["automotive", "auto", "aftermarket"],
  home: ["home goods", "home & garden", "furniture", "decor"],
  industrial: ["industrial", "b2b", "manufacturing", "factory"],
  cannabis: ["cannabis", "cbd", "hemp"],
};

// count matches for a lexicon across plain text + meta keywords
function scoreLexicon(text: string, keywords?: string[]): (lex: Record<string, string[]>) => Record<string, number> {
  const t = text.toLowerCase();
  const kw = (keywords || []).join(" ").toLowerCase();
  return (lex) => {
    const scores: Record<string, number> = {};
    for (const [key, synonyms] of Object.entries(lex)) {
      let n = 0;
      for (const s of synonyms) {
        const re = new RegExp(`\\b${escapeRegExp(s.toLowerCase())}\\b`, "g");
        n += (t.match(re)?.length || 0) + (kw.match(re)?.length || 0);
      }
      if (n > 0) scores[key] = n;
    }
    return scores;
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topKeys(scores: Record<string, number>, max = 8): string[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

// build a concise one-liner from pieces
function composeOneLiner(host: string, role: Role, products: string[], sectors: string[], meta?: { title?: string; description?: string; }) {
  const shortHost = host.replace(/^www\./, "");
  const verb =
    role === "packaging_buyer" ? "buys packaging" :
    role === "packaging_supplier" ? "sells packaging" : "does business";
  const prodBits = products.slice(0, 2).join(", ");
  const secBits = sectors.slice(0, 2).join(" & ");
  let line = `${shortHost} ${verb}`;
  if (prodBits) line += ` — focus on ${prodBits}`;
  if (secBits) line += ` for ${secBits} brands`;
  line += ".";

  // If we have a very clear meta description, prefer a cleaned version that mentions packaging
  const desc = meta?.description || meta?.title;
  if (desc && desc.length >= 40 && /packag/i.test(desc)) {
    // Clean extra whitespace/suffixes
    const clean = desc.replace(/\s+/g, " ").trim();
    // Ensure it ends with a period
    return clean.endsWith(".") ? clean : `${clean}.`;
  }

  return line;
}

// ---- core classify ----------------------------------------------------------
async function classifyHostOnce(host: string) {
  const page = await fetchHomepage(host);
  const parsed = extractTextMeta(page.body);
  const first = ruleClassify(parsed.text, parsed.jsonld);

  // Product + sector signals from lightweight lexicons
  const scorer = scoreLexicon(parsed.text, parsed.keywords);
  const productScores = scorer(PRODUCT_LEX);
  const sectorScores = scorer(SECTOR_LEX);
  const productTags = topKeys(productScores, 12);
  const sectorHints = topKeys(sectorScores, 8);

  const summary = composeOneLiner(
    host,
    first.role,
    productTags,
    sectorHints,
    { title: parsed.title, description: parsed.description }
  );

  // Optional LLM confirmation (schema-bound), only if we have a key and low-ish confidence.
  // (Free plan: keep deterministic, no token spend)
  if (!CFG.geminiApiKey || first.confidence >= 0.8) {
    return {
      ok: true,
      host,
      role: first.role,
      confidence: first.confidence,
      summary,
      productTags,
      sectorHints,
      evidence: first.evidence,
      bytes: page.bytes,
      fetchedAt: new Date().toISOString(),
      cached: false,
    };
  }

  // Placeholder if we later add LLM: keep deterministic
  return {
    ok: true,
    host,
    role: first.role,
    confidence: first.confidence,
    summary,
    productTags,
    sectorHints,
    evidence: [...first.evidence, "llm:skipped"],
    bytes: page.bytes,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

// ---- routes -----------------------------------------------------------------
r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const rawHost = (req.query.host || "") as string;
    const host = normalizeHost(rawHost);
    const email = String((req.query.email || "") as string) || undefined;

    if (!host) return res.status(404).json({ ok: false, error: "bad_host", detail: "Missing or invalid host" });

    // daily limit
    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    // email ↔ domain soft check (no hard reject)
    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) {
      // soft-allow with reduced trust (not used further here)
    }

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );

    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    // Normalize some network errors to a friendly string the UI shows
    const friendly =
      /too-large/.test(msg) ? "site too large" :
      /status\s+4\d\d/.test(msg) ? "blocked or not found" :
      /fetch-failed|aborted|network/i.test(msg) ? "network error while reading your site." :
      msg;
    return res.status(200).json({ ok: false, error: "classify-failed", detail: friendly });
  }
});

r.post("/", async (req: Request, res: ExResponse) => {
  try {
    const body = (req.body || {}) as { host?: string; email?: string };
    const host = normalizeHost(body.host);
    if (!host) return res.status(404).json({ ok: false, error: "bad_host" });

    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    const result = await withCache(
      `class:${host}`,
      CFG.classifyCacheTtlS * 1000,
      () => classifyHostOnce(host)
    );
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json({ ...(result as object), cached: true });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;