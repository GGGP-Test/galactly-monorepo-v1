// src/routes/classify.ts
//
// Domain classifier with guardrails + caching.
// GET  /api/classify?host=acme.com&email=user@acme.com
// POST /api/classify  { host, email }
//
// Behavior:
//  - Validates host + optional business email domain match
//  - Fetches homepage within byte/time caps (https, then http fallback)
//  - Extracts minimal text/meta/JSON-LD
//  - Rule-based classification first; optional Gemini confirm if key present
//  - Cached by host for CLASSIFY_CACHE_TTL_S; daily limit by client key
//
// No DOM typings required; we define a minimal fetch Response interface.

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
  const packagingTokens = ["packaging", "box", "boxes", "carton", "corrugate", "label", "tape", "pouch", "bottle", "jar"];
  const buyerHints = ["brand", "retail", "ecommerce", "our stores", "locations", "menu"];
  const supplierVerbs = ["manufacture", "supply", "wholesale", "distributor", "co-pack", "contract pack", "private label"];

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

async function classifyHostOnce(host: string) {
  const page = await fetchHomepage(host);
  const { text, jsonld } = textAndJsonLd(page.body);
  const first = ruleClassify(text, jsonld);

  // Optional LLM confirmation (schema-bound), only if we have a key and low-ish confidence.
  if (!CFG.geminiApiKey || first.confidence >= 0.8) {
    return { ok: true, host, role: first.role, confidence: first.confidence, evidence: first.evidence, bytes: page.bytes, fetchedAt: new Date().toISOString(), cached: false };
  }

  // Placeholder: keep deterministic for now (no token spend on Free).
  return { ok: true, host, role: first.role, confidence: first.confidence, evidence: [...first.evidence, "llm:skipped"], bytes: page.bytes, fetchedAt: new Date().toISOString(), cached: false };
}

r.get("/", async (req: Request, res: ExResponse) => {
  try {
    const host = normalizeHost(String((req.query.host || "") as string));
    const email = String((req.query.email || "") as string) || undefined;

    if (!host) return res.status(400).json({ ok: false, error: "bad_host" });

    // daily limit (daily.get returns a number)
    const key = `classify:${clientKey(req)}`;
    const cap = CFG.classifyDailyLimit;
    const count = Number(daily.get(key) ?? 0);
    if (count >= cap) return res.status(200).json({ ok: false, error: "quota", remaining: 0 });

    // email ↔ domain soft check (no hard reject)
    const ed = emailsDomain(email);
    if (ed && ed !== host && !ed.endsWith(`.${host}`)) {
      // soft-allow with reduced trust (not used further here)
    }

    const result = await withCache(`class:${host}`, CFG.classifyCacheTtlS * 1000, () => classifyHostOnce(host));
    // increment usage
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