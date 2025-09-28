// src/routes/classify.ts
//
// Domain classifier with guardrails + caching + lightweight tag/sector mining.
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

// Minimal Fetch response type for Node 20 without DOM libs.
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

// -------------------- helpers --------------------

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
      if (!res.ok) { lastErr = new Error(`status ${res.status}`); continue; }
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

function extractTitleMeta(html: string): { title: string; meta: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const meta =
    html
      .match(/<meta[^>]+name=["']description["'][^>]*>/gi)
      ?.map(m => m.match(/\bcontent=["']([^"']+)["']/i)?.[1] || "")
      .join(" ") || "";
  return { title, meta };
}

function textAndJsonLd(html: string): { text: string; jsonld: string[] } {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200000);
  const jsonld: string[] = [];
  const re = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const payload = m[1]?.trim();
    if (payload) jsonld.push(payload);
  }
  return { text: text.trim(), jsonld };
}

type Role = "packaging_supplier" | "packaging_buyer" | "neither";

function ruleClassify(text: string, jsonld: string[]): { role: Role; confidence: number; evidence: string[] } {
  const t = text.toLowerCase();

  const productSignals = ["product", "catalog", "shop", "store", "price", "cart", "sku"];
  const packagingTokens = ["packaging", "box", "boxes", "carton", "label", "labels", "corrugate", "pouch", "pouches", "bottle", "bottles", "jar", "jars", "film", "films", "mailer", "mailers", "clamshell", "blister"];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "supply", "wholesale", "distributor", "co-pack", "contract pack", "private label"];

  const contains = (arr: string[]) => arr.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);

  const prod = contains(productSignals);
  const pack = contains(packagingTokens);
  const buy = contains(buyerHints);
  const sup = contains(supplierVerbs);

  let scoreSupplier = sup + pack + (prod > 0 ? 1 : 0);
  let scoreBuyer = buy + (prod > 0 ? 1 : 0);

  for (const raw of jsonld) {
    try {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        const ttype = (o && (o["@type"] || o.type)) || "";
        const s = typeof ttype === "string" ? ttype.toLowerCase() : "";
        if (s.includes("wholesalestore") || s.includes("manufacturer")) scoreSupplier += 1;
        if (s.includes("store") || s.includes("localbusiness")) scoreBuyer += 1;
      }
    } catch { /* ignore */ }
  }

  const evidence: string[] = [];
  if (prod) evidence.push(`product_signals:${prod}`);
  if (pack) evidence.push(`packaging_terms:${pack}`);
  if (sup) evidence.push(`supplier_verbs:${sup}`);
  if (buy) evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2) return { role: "packaging_supplier", confidence: Math.min(1, 0.55 + 0.1 * scoreSupplier), evidence };
  if (scoreBuyer >= 2) return { role: "packaging_buyer", confidence: Math.min(1, 0.55 + 0.1 * scoreBuyer), evidence };
  return { role: "neither", confidence: 0.35, evidence };
}

// --- light product + sector mining (deterministic) ---

const PRODUCT_LEXICON = [
  "boxes","cartons","labels","pouches","bottles","jars","tape","corrugate","films","mailers",
  "clamshells","blister","trays","caps","closures","lids","bags","tubes","canisters","cans",
  "shrink","stretch","void fill","inserts","foam","clamshell","thermoform","rigid","flexible",
  "glass","aluminum","pet","hdpe","ldpe","pp","paperboard","kraft"
];
const SECTOR_LEXICON = [
  "food","beverage","cosmetics","beauty","apparel","fashion","electronics",
  "pharma","pharmaceutical","supplements","nutraceuticals","cannabis","pet","industrial","home"
];

function mineTokens(t: string, lex: string[], max = 8): string[] {
  const lc = t.toLowerCase();
  const hits = new Map<string, number>();
  for (const raw of lex) {
    const key = raw.toLowerCase();
    const pattern = new RegExp(`\\b${key.replace(/\s+/g,"\\s+")}\\b`, "g");
    const m = lc.match(pattern);
    if (m && m.length) hits.set(normalizeToken(key), m.length);
  }
  return [...hits.entries()]
    .sort((a,b)=>b[1]-a[1])
    .slice(0, max)
    .map(([k])=>prettyToken(k));
}
function normalizeToken(s: string): string {
  return s.replace(/\s+/g," ").trim();
}
function prettyToken(s: string): string {
  const up = s.toUpperCase();
  if (["PET","HDPE","LDPE","PP"].includes(up)) return up;
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// --- one-liner composer ---

function composeOneLiner(host: string, role: Role, products: string[], sectors: string[], title: string, meta: string): string {
  const domain = host.trim().toLowerCase();
  const name = (title || domain).replace(/\s*\|\s*.*$/, "").replace(/\s*-\s*.*$/, "").slice(0, 60);
  const prod = products.slice(0,3).join(", ") || "packaging";
  const sect = sectors.slice(0,3).join(", ");
  const verb = role === "packaging_buyer" ? "buys" : "sells";
  const tail = sect ? ` to brands in ${sect}` : " to brands";
  // Use meta to upgrade verb if it looks like services-only
  const metaLc = (meta || "").toLowerCase();
  const servicesOnly = /design|engineering|consult(ing)?/.test(metaLc) && !/manufactur|produce/.test(metaLc);
  const verb2 = servicesOnly ? "provides" : verb;
  return `${name} ${verb2} ${prod}${tail}.`;
}

function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

// -------------------- core --------------------

async function classifyHostOnce(host: string) {
  const page = await fetchHomepage(host);
  const { title, meta } = extractTitleMeta(page.body);
  const { text, jsonld } = textAndJsonLd(page.body);
  const first = ruleClassify(text, jsonld);

  // product & sector cues (deterministic, cheap)
  const productTags = mineTokens(text, PRODUCT_LEXICON, 10);
  const sectorsRaw = mineTokens(text, SECTOR_LEXICON, 10);
  // canonicalize sectors (merge aliases)
  const sectors = Array.from(new Set(
    sectorsRaw.map(s => {
      const lc = s.toLowerCase();
      if (lc === "beauty") return "cosmetics";
      if (lc === "pharmaceutical") return "pharma";
      return s.toLowerCase();
    })
  )).map(prettyToken);

  const oneLiner = composeOneLiner(host, first.role, productTags, sectors, title, meta);

  return {
    ok: true as const,
    host,
    role: first.role,
    confidence: first.confidence,
    evidence: first.evidence,
    bytes: page.bytes,
    fetchedAt: new Date().toISOString(),
    cached: false,
    oneLiner,
    productTags,
    sectors,
    favicon: faviconUrl(host)
  };
}

// -------------------- routes --------------------

r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const host = normalizeHost(String((req.query.host || "") as string));
    const email = String((req.query.email || "") as string) || undefined;
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    // daily limit
    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    // soft check email ↔ domain (no hard reject)
    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) {
      // optional: we could lower trust here; not used yet.
    }

    const result = await withCache(`class:${host}`, CFG.classifyCacheTtlS * 1000, () => classifyHostOnce(host));
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json(result);
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

r.post("/", async (req: Request, res: ExResponse) => {
  try {
    const body = (req.body || {}) as { host?: string; email?: string };
    const host = normalizeHost(body.host);
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    const result = await withCache(`class:${host}`, CFG.classifyCacheTtlS * 1000, () => classifyHostOnce(host));
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json(result);
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;