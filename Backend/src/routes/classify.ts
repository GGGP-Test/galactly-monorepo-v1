// src/routes/classify.ts
//
// Domain classifier + lightweight summarizer with guardrails & caching.
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }
//
// Returns:
//  - role: "packaging_supplier" | "packaging_buyer" | "neither"
//  - confidence: 0..1
//  - oneLiner: string
//  - productTags: string[]        // for Product signals chips
//  - sectors: string[]            // for Buyer targeting chips
//  - title: string, h1s: string[] // UX context
//  - favicon: string              // convenience favicon URL
//  - evidence, bytes, cached, fetchedAt
//
// Deterministic (no LLM spend). Caches by host for CLASSIFY_CACHE_TTL_S.

import { Router, Request, Response as ExResponse } from "express";
import { withCache, daily } from "../shared/guards";
import { CFG } from "../shared/env";

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

// ---------- helpers ----------

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

function extractTitleH1(html: string): { title: string; h1s: string[] } {
  const tMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (tMatch?.[1] || "").replace(/\s+/g, " ").trim();
  const h1s: string[] = [];
  const re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1] || "";
    const t = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) h1s.push(t);
  }
  return { title, h1s };
}

function textAndJsonLd(html: string): { text: string; jsonld: string[] } {
  const text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200000)
    .toLowerCase();
  const jsonld: string[] = [];
  const re = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const payload = (m[1] || "").trim();
    if (payload) jsonld.push(payload);
  }
  return { text: text.trim(), jsonld };
}

type Role = "packaging_supplier" | "packaging_buyer" | "neither";

const PRODUCT_TOKENS = [
  "packaging","box","boxes","carton","cartons","corrugate","corrugated",
  "mailers","label","labels","sticker","stickers","pouch","pouches",
  "bottle","bottles","jar","jars","tube","tubes","can","cans",
  "tray","trays","insert","inserts","tape","films","shrink","clamshell",
  "bag","bags","foil","mylar","kraft","rigid","folding","carton"
];

const SUPPLIER_VERBS = ["manufacture","manufacturer","supply","supplier","custom","co-pack","copack","contract pack","private label","wholesale","converter","print","die cut","laminate"];

const BUYER_HINTS = ["brand","retail","retailer","store","locations","menu","our stores","shop","basket","cart","checkout","collection"];

const SECTOR_WORDS = [
  "food","beverage","drinks","cosmetics","beauty","skincare","health","supplements",
  "vitamin","pharma","cannabis","cbd","coffee","tea","chocolate","bakery","confectionery",
  "pet","apparel","fashion","electronics","home","cleaning","industrial","automotive"
];

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) {
    // word boundary where sensible; fall back to simple includes.
    const rx = /\w/.test(w[w.length - 1]) ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") : null;
    if (rx ? rx.test(text) : text.includes(w)) n++;
  }
  return n;
}

function topMatches(text: string, words: string[], max = 8): string[] {
  const scored = words.map(w => {
    const rx = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const c = (text.match(rx) || []).length;
    return { w, c };
  }).filter(x => x.c > 0);
  scored.sort((a,b)=>b.c-a.c);
  const out = scored.slice(0, max).map(x=>x.w);
  // small enrichment: plural ↔ singular dedupe
  const dedup = Array.from(new Set(out.map(w => w.replace(/s$/, ""))));
  return dedup;
}

function ruleClassify(text: string, jsonld: string[]): { role: Role; confidence: number; evidence: string[] } {
  const prod = countHits(text, PRODUCT_TOKENS);
  const sup  = countHits(text, SUPPLIER_VERBS);
  const buy  = countHits(text, BUYER_HINTS);

  let scoreSupplier = sup + prod > 0 ? 1 + sup + Math.min(2, prod) : 0;
  let scoreBuyer    = buy + (prod > 0 ? 1 : 0);

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
    } catch { /* ignore bad JSON-LD */ }
  }

  const evidence: string[] = [];
  if (prod) evidence.push(`product_tokens:${prod}`);
  if (sup)  evidence.push(`supplier_verbs:${sup}`);
  if (buy)  evidence.push(`buyer_hints:${buy}`);

  if (scoreSupplier >= scoreBuyer && scoreSupplier >= 2) {
    return { role: "packaging_supplier", confidence: Math.min(1, 0.55 + 0.08 * scoreSupplier), evidence };
  }
  if (scoreBuyer >= 2) {
    return { role: "packaging_buyer", confidence: Math.min(1, 0.55 + 0.08 * scoreBuyer), evidence };
  }
  return { role: "neither", confidence: 0.35, evidence };
}

function buildOneLiner(host: string, role: Role, productTags: string[], sectors: string[], title: string, h1s: string[]): string {
  const brand = host.replace(/^www\./, "");
  const prod = productTags.slice(0,3).join(", ") || "packaging";
  const sect = sectors.slice(0,3).join(", ") || "brands";
  if (role === "packaging_buyer") {
    return `${brand} buys ${prod} for ${sect}.`;
  }
  if (role === "packaging_supplier") {
    return `${brand} sells ${prod} to ${sect}.`;
  }
  // fallback – use title/h1 clue if helpful
  const clue = (title || h1s[0] || "").replace(/\s+/g, " ").trim();
  if (clue) return `${brand} — ${clue}`;
  return `${brand} — we couldn’t confirm packaging focus yet.`;
}

function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

async function classifyHostOnce(host: string) {
  const page = await fetchHomepage(host);
  const { title, h1s } = extractTitleH1(page.body);
  const { text, jsonld } = textAndJsonLd(page.body);

  // base role
  const first = ruleClassify(text, jsonld);

  // product + sector hints
  const productTags = topMatches(text, PRODUCT_TOKENS, 10);
  const sectors     = topMatches(text, SECTOR_WORDS, 8);

  const oneLiner = buildOneLiner(host, first.role, productTags, sectors, title, h1s);

  return {
    ok: true as const,
    host,
    role: first.role,
    confidence: first.confidence,
    oneLiner,
    productTags,
    sectors,
    title,
    h1s,
    favicon: faviconUrl(host),
    evidence: first.evidence,
    bytes: page.bytes,
    fetchedAt: new Date().toISOString(),
    cached: false as const,
  };
}

// ---------- routes ----------

r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const host = normalizeHost(String((req.query.host || "") as string));
    const email = String((req.query.email || "") as string) || undefined;
    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    // daily limit
    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const used = Number(daily.get(key) ?? 0);
    if (used >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    // soft email↔domain note (no hard reject)
    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) {
      // could flag lowered trust later
    }

    const result = await withCache(`class:${host}`, CFG.classifyCacheTtlS * 1000, () => classifyHostOnce(host));
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json({ ...result, cached: result ? (daily.get("nope") === -1 ? false : true) : false }); // cached flag already false inside; harmless
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
    const used = Number(daily.get(key) ?? 0);
    if (used >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    const result = await withCache(`class:${host}`, CFG.classifyCacheTtlS * 1000, () => classifyHostOnce(host));
    if (typeof daily.inc === "function") daily.inc(key, 1);
    return res.json(result);
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    return res.status(200).json({ ok: false, error: "classify-failed", detail: msg });
  }
});

export default r;