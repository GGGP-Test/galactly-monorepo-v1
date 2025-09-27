// src/routes/classify.ts
//
// Domain classifier with guardrails + caching.
// - GET  /api/classify/domain?host=acme.com
// - POST /api/classify/domain   { "host": "acme.com" }
//
// Pipeline:
//   1) Fetch homepage (https first, http fallback), byte + time capped
//   2) Extract visible text + meta + JSON-LD
//   3) Rule-based score => quick decision + evidence
//   4) (Optional) Gemini 2.5 confirmation if key is present
//   5) Cache result (TTL) and daily-limit by IP or x-api-key
//
// Cost controls: uses shared guards (daily + burst) and withCache.

import { Router, Request, Response } from "express";
import { CFG } from "../shared/env";
import { withCache, daily, rate } from "../shared/guards";

const r = Router();

// Use global fetch (Node 18/20) with explicit type to keep TS happy.
const F: (input: any, init?: any) => Promise<any> = (globalThis as any).fetch;

type Role = "packaging_supplier" | "packaging_buyer" | "neither";

interface ClassifyResult {
  ok: boolean;
  host: string;
  role: Role;
  confidence: number;      // 0..1
  evidence: string[];      // compact human-readable bullets
  bytes?: number;
  cached?: boolean;
  fetchedAt?: string;
  sources?: {
    rule?: { score: number; productScore: number; packagingHits: number; buyerHits: number };
    gemini?: { used: boolean; confidence?: number };
  };
  error?: string;
  detail?: string;
}

function q(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown> | undefined)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function isLikelyHost(s: string): boolean {
  if (!s) return false;
  const host = s.toLowerCase();
  if (host.includes("://")) return false;
  // letters, numbers, dots, hyphens
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  // must contain a dot and not start/end with dot or hyphen
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host.includes("..")) return false;
  return true;
}

function asHost(raw: string): string {
  return raw.toLowerCase().replace(/^www\./, "");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

async function timedFetch(url: string, timeoutMs: number): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await F(url, {
      signal: c.signal,
      headers: { "user-agent": "GalactlyBot/1.0 (+classify; contact: support@galactly.example)", "accept-language": "en-US,en;q=0.7" },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function fetchHomepage(host: string): Promise<{ html: string; url: string }> {
  const timeout = Number(CFG.fetchTimeoutMs || 10_000);
  const maxBytes = Number(CFG.maxFetchBytes || 800_000);

  const tries = [`https://${host}`, `http://${host}`];
  let lastErr: unknown;

  for (const u of tries) {
    try {
      const res: Response = await timedFetch(u, timeout);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      // Cap bytes
      const buf = await res.arrayBuffer();
      const slice = buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(slice);
      return { html, url: res.url || u };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch-failed");
}

function extractText(html: string): { text: string; meta: Record<string,string>; jsonld: string[]; title?: string; headings?: string[] } {
  try {
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");

    // Title + headings
    const titleMatch = cleaned.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;
    const headingMatches = Array.from(cleaned.matchAll(/<(h1|h2|h3)[^>]*>([^<]{0,200})<\/\1>/gi)).map(m => m[2].trim());

    // Meta
    const meta: Record<string,string> = {};
    const metaRe = /<meta[^>]+(name|property)=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = metaRe.exec(cleaned))) meta[mm[2].toLowerCase()] = mm[3];

    // JSON-LD blocks
    const jsonld: string[] = [];
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ld: RegExpExecArray | null;
    while ((ld = ldRe.exec(cleaned))) {
      const raw = (ld[1] || "").trim();
      if (raw) jsonld.push(raw.slice(0, 50_000)); // cap each block
    }

    const visible = cleaned
      .replace(/<\/?[^>]+>/g, " ")       // drop tags
      .replace(/\s+/g, " ")              // collapse
      .trim();

    return { text: visible.slice(0, 300_000), meta, jsonld, title, headings: headingMatches };
  } catch {
    return { text: "", meta: {}, jsonld: [] };
  }
}

function countContains(hay: string, needles: string[]): number {
  const H = hay.toLowerCase();
  let n = 0;
  for (const k of needles) if (H.includes(k)) n++;
  return n;
}

function scoreRules(payload: { text: string; meta: Record<string,string>; jsonld: string[]; title?: string; headings?: string[] }) {
  const t = [payload.title || "", ...(payload.headings || []), payload.text].join(" \n ").toLowerCase();

  // Strong signals the business sells physical products (not SaaS/services-only)
  const productSignals = [
    "add to cart","cart","checkout","shop now","catalog","collection",
    "sku","in stock","out of stock","ingredients","nutrition facts",
    "our products","product line","price $","price:","buy now","menu","store"
  ];

  // Packaging domain tokens (both materials + converting/printing verbs)
  const packagingTokens = [
    "packaging","package","packages","carton","cartons","corrugated","corrugate","mailer",
    "box","boxes","rigid box","shipper","case pack","pallet","void fill","insert",
    "label","labels","sticker","stickers","hang tag","sleeve","shrink sleeve",
    "bottle","jar","closure","cap","lid","tube","pouch","bag","film","laminate",
    "thermoform","blister","clamshell","tray","canister","container","keg","drum",
    "co-pack","copack","contract pack","contract packaging",
    "converter","converting","die cut","printing","flexo","offset","digital print","prepress"
  ];

  // Hints they *buy* packaging (typical CPG verticals, menus, etc.)
  const buyerCategoryHints = [
    "coffee","cafe","roastery","bakery","restaurant","catering","beverage","bottling",
    "brewery","distillery","winery","cider","juice","smoothie","snack","candy","chocolate",
    "cpg","cosmetics","skincare","beauty","haircare","vitamin","supplement","nutraceutical",
    "pet food","candles","home fragrance","soap","detergent","cleaner","grocery","retail"
  ];

  // Verbs implying manufacturing/supplying
  const supplierVerbs = [
    "manufacture","manufactures","manufacturer","we manufacture","produce","production",
    "converter","convert","printing","we print","we supply","supplier","wholesale","distributor","stock","warehouse","factory","plant"
  ];

  // JSON-LD hints for physical products or local business
  const jsonldHints = ["Product","Offer","Organization","LocalBusiness","Store","WholesaleStore","Manufacturer"];

  const productScore = countContains(t, productSignals);
  const packagingHits = countContains(t, packagingTokens);
  const buyerHits = countContains(t, buyerCategoryHints);
  const supplierHits = countContains(t, supplierVerbs);

  let jsonldScore = 0;
  for (const raw of payload.jsonld) {
    try {
      const obj = JSON.parse(raw);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) {
        const type = (o && (o["@type"] || o.type)) || "";
        if (typeof type === "string" && jsonldHints.some(h => String(type).toLowerCase().includes(h.toLowerCase()))) jsonldScore++;
        if (Array.isArray(type) && type.some((t2: any) => jsonldHints.includes(String(t2)))) jsonldScore++;
      }
    } catch { /* ignore */ }
  }

  // Rule-based role
  let role: Role = "neither";
  let ruleScore = 0;

  // Must look like physical product business
  const looksProduct = productScore > 0 || jsonldScore > 0 || /product|shop|store/.test(t);

  if (looksProduct) {
    if (packagingHits >= 2 && (supplierHits >= 1 || /we (manufacture|print|supply)/.test(t))) {
      role = "packaging_supplier"; ruleScore = 0.8 + Math.min(0.2, (packagingHits + supplierHits) * 0.02);
    } else if (packagingHits >= 1 && buyerHits >= 1) {
      role = "packaging_buyer"; ruleScore = 0.65 + Math.min(0.2, (buyerHits + packagingHits) * 0.02);
    } else if (buyerHits >= 2 && packagingHits === 0) {
      // Clear CPG signal with few/no packaging terms -> likely a buyer of packaging
      role = "packaging_buyer"; ruleScore = 0.55 + Math.min(0.2, buyerHits * 0.02);
    } else {
      role = "neither"; ruleScore = 0.35;
    }
  } else {
    role = "neither"; ruleScore = 0.25;
  }

  const evidence: string[] = [];
  if (payload.title) evidence.push(`title: ${payload.title.slice(0, 90)}`);
  if ((payload.headings || []).length) evidence.push(`h1-3:${" " + (payload.headings || []).slice(0,3).map(h=>h.toLowerCase()).join(" · ")}`);
  if (productScore) evidence.push(`product-signals:${productScore}`);
  if (packagingHits) evidence.push(`packaging-hits:${packagingHits}`);
  if (supplierHits) evidence.push(`supplier-verbs:${supplierHits}`);
  if (buyerHits) evidence.push(`buyer-hints:${buyerHits}`);
  if (jsonldScore) evidence.push(`jsonld:${jsonldScore}`);

  return { role, ruleScore: clamp(ruleScore, 0, 1), productScore, packagingHits, buyerHits, evidence };
}

async function askGemini(snippet: string): Promise<{ role: Role; confidence: number; reasons: string[] }> {
  const key = (CFG.geminiApiKey || "").trim();
  if (!key) return { role: "neither", confidence: 0, reasons: ["gemini:disabled"] };

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
  const prompt =
`You are classifying a business by its homepage excerpt.

Return STRICT JSON: {"role":"packaging_supplier|packaging_buyer|neither","confidence":0..1,"reasons":["...","..."]}

Definitions:
- "packaging_supplier": the site sells packaging materials or converting/printing services (boxes, cartons, pouches, labels, bottles, sleeves, contract packaging).
- "packaging_buyer": the site sells OTHER physical products and likely buys packaging (CPG/food & bev/cosmetics/retail/etc).
- "neither": SAAS/services only, unrelated industries, unclear.

Be conservative. Prefer "neither" unless the text implies products or packaging clearly.

TEXT:
${snippet}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  };

  const url = `${endpoint}?key=${encodeURIComponent(key)}`;
  const res = await F(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  // Try to parse the model output (it might wrap JSON in text)
  const rawText: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ||
    "";

  let parsed: any = null;
  try { parsed = JSON.parse(rawText); }
  catch {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (m) try { parsed = JSON.parse(m[0]); } catch {}
  }

  const roleStr = typeof parsed?.role === "string" ? parsed.role : "neither";
  const conf = typeof parsed?.confidence === "number" ? parsed.confidence : 0.0;
  const reasons = Array.isArray(parsed?.reasons) ? parsed.reasons.slice(0, 5) : ["gemini:unparsed"];

  const map: Record<string, Role> = {
    packaging_supplier: "packaging_supplier",
    supplier: "packaging_supplier",
    packaging_buyer: "packaging_buyer",
    buyer: "packaging_buyer",
    neither: "neither",
    unknown: "neither",
  };

  return { role: map[roleStr as keyof typeof map] || "neither", confidence: clamp(conf, 0, 1), reasons };
}

function clientKey(req: Request): string {
  const apiKey = (req.headers["x-api-key"] || "") as string;
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  return apiKey ? `k:${apiKey}` : `ip:${ip}`;
}

async function classifyHost(hostRaw: string, req: Request): Promise<ClassifyResult> {
  const host = asHost(hostRaw);

  // Daily + burst guard
  const who = clientKey(req);
  const dailyLimit = Math.max(1, Number(CFG.classifyDailyLimit || 25));
  const day = daily.allow(`classify:${who}`, dailyLimit);
  if (!day.ok) return { ok: false, host, role: "neither", confidence: 0, evidence: [], error: "daily-quota-exceeded" };

  const burst = rate.allow(`classify:${who}`, 5, 10_000);
  if (!burst.ok) return { ok: false, host, role: "neither", confidence: 0, evidence: [], error: "rate-limited", detail: String(burst.resetInMs) };

  // Cache
  const cacheTtlMs = Math.max(5, Number(CFG.classifyCacheTtlS || 86_400)) * 1000;
  const cacheKey = `classify:${host}`;
  return await withCache(cacheKey, cacheTtlMs, async (): Promise<ClassifyResult> => {
    const { html, url } = await fetchHomepage(host);
    const bytes = html.length;
    const parsed = extractText(html);

    // Rule step
    const rule = scoreRules(parsed);
    let role: Role = rule.role;
    let conf = rule.ruleScore;
    const evidence = [...rule.evidence, `fetched:${url}`];

    // If we have Gemini, ask for confirmation and combine
    let gem: { used: boolean; confidence?: number } = { used: false };
    if ((CFG.geminiApiKey || "").trim()) {
      gem.used = true;

      // Keep prompt size modest
      const snippet = [parsed.title || "", ...(parsed.headings || []), parsed.text].join("\n\n").slice(0, 12_000);
      const llm = await askGemini(snippet);

      // Combine: weighted average pulling toward LLM if it agrees, else keep rule lean.
      if (llm.role === role) {
        conf = clamp(0.6 * conf + 0.4 * llm.confidence, 0, 1);
      } else {
        // Disagreement: if LLM is very confident, nudge; else trust rules.
        if (llm.confidence >= 0.8) { role = llm.role; conf = clamp(0.55 + 0.35 * llm.confidence, 0, 1); }
        else { conf = clamp(conf * 0.9, 0, 1); }
      }
      evidence.push(`gemini: ${llm.role} (${Math.round(llm.confidence*100)}%)`, ...llm.reasons.slice(0,2));
      gem.confidence = llm.confidence;
    }

    return {
      ok: true,
      host,
      role,
      confidence: clamp(conf, 0, 1),
      evidence,
      bytes,
      fetchedAt: new Date().toISOString(),
      sources: {
        rule: { score: rule.ruleScore, productScore: rule.productScore, packagingHits: rule.packagingHits, buyerHits: rule.buyerHits },
        gemini: gem,
      },
    };
  });
}

async function handle(req: Request, res: Response) {
  try {
    const hostRaw = (req.method === "GET" ? q(req, "host") : undefined) || (req.body?.host as string) || "";
    if (!isLikelyHost(hostRaw)) {
      return res.status(200).json({ ok: false, host: hostRaw, role: "neither", confidence: 0, evidence: [], error: "invalid-host" } as ClassifyResult);
    }
    const out = await classifyHost(hostRaw, req);
    return res.status(200).json(out);
  } catch (err: unknown) {
    return res.status(200).json({ ok: false, host: "", role: "neither", confidence: 0, evidence: [], error: "classify-failed", detail: String((err as any)?.message || err) } as ClassifyResult);
  }
}

r.get("/domain", handle);
r.post("/domain", handle);

export default r;