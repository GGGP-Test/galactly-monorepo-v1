/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Discovery module
 * - Fetches supplier homepage (server-side, Node 20 global fetch)
 * - Extracts low-cost signals (titles, headings, keywords, locations)
 * - Calls OpenRouter ONCE (cheap model) to hypothesize latent metrics + 3–5 buyer archetypes
 * - Produces a list of candidate directory sources (to be used by pipeline)
 * - Caches by supplier domain in-memory and to a small JSON file on disk
 * - Emits structured evidence logs via BleedStore (best-effort; no-throw)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---- BleedStore (best-effort dynamic import, tolerant to API differences)
type Evidence = {
  at: string; // ISO time
  stage: "discovery" | "pipeline";
  supplier?: string;
  topic: string;
  detail: any;
  source?: string;
};

type LeadLike = {
  id?: string;
  company?: string;
  domain?: string;
  region?: string;
  score?: number;
  source?: string;
  evidence?: Evidence[];
};

let bleedStore: any | null = null;
(function loadBleedStore() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../data/bleed-store");
    bleedStore =
      (mod && (mod.getStore?.() || mod.store || mod.default || mod)) || null;
  } catch {
    bleedStore = null;
  }
})();

function emitEvidence(ev: Evidence, lead?: LeadLike) {
  try {
    if (!bleedStore) {
      console.log("[bleed:evidence]", JSON.stringify(ev));
      return;
    }
    // Try common method names; swallow on failure (no-throw).
    if (typeof bleedStore.appendEvidence === "function") {
      bleedStore.appendEvidence(ev, lead);
      return;
    }
    if (typeof bleedStore.addEvidence === "function") {
      bleedStore.addEvidence(ev, lead);
      return;
    }
    if (typeof bleedStore.recordEvidence === "function") {
      bleedStore.recordEvidence(ev, lead);
      return;
    }
    // As a last resort, attach to a synthetic lead so UI has something to render.
    if (typeof bleedStore.upsertLead === "function") {
      const sid = `DISCOVERY::${(lead?.domain || ev.supplier || ev.topic || "unknown")
        .toString()
        .slice(0, 128)}`;
      bleedStore.upsertLead({
        id: sid,
        company: "Discovery Evidence",
        domain: ev.supplier || lead?.domain || "n/a",
        source: "DISCOVERY_EVIDENCE",
        evidence: [ev],
      });
    }
  } catch (e) {
    console.warn("[bleed:evidence:error]", (e as Error).message);
  }
}

// ---- Types

export type DiscoveryInput = {
  supplier: string; // domain or URL; e.g. "acme-packaging.com" or "https://acme.com"
  region?: string; // optional geographic hint
  persona?: any; // optional client-provided persona to pass-through
};

export type Signals = {
  title?: string;
  headings?: string[];
  keywords?: Record<string, number>;
  services?: string[];
  locations?: string[];
  skuHints?: string[];
  hiringHints?: string[];
  certifications?: string[];
  siteTextSample?: string;
};

export type Latents = {
  IrregularLoadLikelihood?: number; // 0..1
  ColdChainSensitivity?: number; // 0..1
  FragilityRisk?: number; // 0..1
  SustainabilityPriority?: number; // 0..1
  Seasonality?: number; // 0..1
  OrderSizeVariability?: number; // 0..1
  Notes?: string;
};

export type Archetype = {
  name: string;
  description: string;
  indicators: string[];
  leadQuery: string; // short search query to find matching buyers
};

export type CandidateSource = {
  id: string;
  kind: "DIRECTORY" | "SEARCH";
  description: string;
  urlTemplate: string; // include tokens: {query}, {region}
  query?: string; // default query to plug into urlTemplate
};

export type DiscoveryOutput = {
  supplierDomain: string;
  normalizedURL: string;
  cached: boolean;
  signals: Signals;
  latents: Latents;
  archetypes: Archetype[];
  candidateSources: CandidateSource[];
  persona?: any; // passthrough or inferred
};

// ---- Simple cache (in-memory + file)
const CACHE_FILE = path.join(process.cwd(), "backend", ".cache.discovery.json");
const memCache = new Map<string, DiscoveryOutput>();

function readCacheFile(): Record<string, DiscoveryOutput> {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeCacheFile(obj: Record<string, DiscoveryOutput>) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.warn("[discovery:cache:write:error]", (e as Error).message);
  }
}

function cacheGet(key: string): DiscoveryOutput | undefined {
  if (memCache.has(key)) return memCache.get(key);
  const file = readCacheFile();
  const val = file[key];
  if (val) memCache.set(key, val);
  return val;
}
function cacheSet(key: string, val: DiscoveryOutput) {
  memCache.set(key, val);
  const file = readCacheFile();
  file[key] = val;
  writeCacheFile(file);
}

// ---- Helpers

function normalizeSupplierURL(supplier: string): { domain: string; url: string } {
  let s = supplier.trim();
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    // If still bad, assume domain-like
    s = `https://${supplier}`;
    u = new URL(s);
  }
  const domain = u.hostname.replace(/^www\./i, "");
  return { domain, url: `https://${domain}` };
}

async function fetchText(url: string, timeoutMs = 10_000): Promise<string> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent":
          "buyers-engine/1.0 (+https://github.com/; Node20 server fetch)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      } as any,
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(to);
  }
}

function extractBetween(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const txt = m[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (txt) out.push(txt);
  }
  return out;
}

function countKeywords(text: string, kws: string[]): Record<string, number> {
  const t = ` ${text.toLowerCase()} `;
  const res: Record<string, number> = {};
  for (const k of kws) {
    const needle = ` ${k.toLowerCase()} `;
    let idx = 0;
    let c = 0;
    while ((idx = t.indexOf(needle, idx)) !== -1) {
      c++;
      idx += needle.length;
    }
    if (c > 0) res[k] = c;
  }
  return res;
}

function deriveSignals(html: string): Signals {
  const title = extractBetween(html, "title")[0];
  const headings = [
    ...extractBetween(html, "h1"),
    ...extractBetween(html, "h2"),
    ...extractBetween(html, "h3"),
  ].slice(0, 20);

  const textSample = extractBetween(html, "body")
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 2000);

  const services: string[] = [];
  const svcHintRegex =
    /(services?|solutions?|capabilities?|what we do|our products?)[:\s]([^.]{0,200})/gi;
  let ms: RegExpExecArray | null;
  while ((ms = svcHintRegex.exec(html))) {
    const snip = ms[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (snip) services.push(snip);
  }

  const locationHints: string[] = [];
  const locRegex =
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:Office|Plant|Warehouse|Facility|HQ|Headquarters)\b/g;
  let ml: RegExpExecArray | null;
  while ((ml = locRegex.exec(html))) {
    locationHints.push(ml[1]);
  }

  const skuHints: string[] = [];
  const liMatches = html.match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
  for (const li of liMatches.slice(0, 100)) {
    const txt = li.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (/(sku|item|model|part)\s*[:#-]?\s*[A-Z0-9-]{3,}/i.test(txt)) {
      skuHints.push(txt.slice(0, 100));
    }
  }

  const hiringHints: string[] = [];
  const careersPaths = ["/careers", "/jobs", "/join-us", "/join", "/about/careers"];
  for (const p of careersPaths) {
    if (html.toLowerCase().includes(p)) hiringHints.push(p);
  }

  const certs: string[] = [];
  for (const c of ["ISO 9001", "ISO 14001", "BRC", "FSC", "GMP", "HACCP"]) {
    if (new RegExp(c, "i").test(html)) certs.push(c);
  }

  const keywords = countKeywords(textSample, [
    "cold",
    "frozen",
    "temperature",
    "fragile",
    "stretch film",
    "pallet",
    "3pl",
    "warehouse",
    "just-in-time",
    "sustainability",
    "recycl",
    "biodegrad",
    "corrugated",
    "shrink",
    "tape",
    "void fill",
    "foam",
    "bubble",
  ]);

  return {
    title,
    headings,
    keywords,
    services,
    locations: [...new Set(locationHints)].slice(0, 20),
    skuHints: skuHints.slice(0, 20),
    hiringHints: hiringHints.slice(0, 10),
    certifications: certs,
    siteTextSample: textSample,
  };
}

function cheapHeuristicLatents(sig: Signals): Latents {
  const kw = sig.keywords || {};
  const score = (k: string, w = 1) => (kw[k] ? Math.min(1, 0.2 + 0.15 * kw[k] * w) : 0.15);
  const lat: Latents = {
    IrregularLoadLikelihood: Math.max(score("pallet"), score("stretch film"), score("corrugated")),
    ColdChainSensitivity: Math.max(score("cold", 1.2), score("frozen", 1.2), score("temperature")),
    FragilityRisk: Math.max(score("fragile"), score("foam"), score("bubble")),
    SustainabilityPriority: Math.max(score("sustainability", 1.3), score("recycl"), score("biodegrad")),
    Seasonality: 0.2,
    OrderSizeVariability: sig.skuHints && sig.skuHints.length > 2 ? 0.55 : 0.25,
    Notes: "Heuristic latents (no LLM).",
  };
  return lat;
}

async function callOpenRouter(sig: Signals, supplierDomain: string): Promise<{
  latents: Latents;
  archetypes: Archetype[];
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      latents: cheapHeuristicLatents(sig),
      archetypes: [
        {
          name: "E-comm Fulfillment",
          description: "3PLs and e-commerce warehouses needing high parcel throughput.",
          indicators: ["mentions: 3PL, warehouse, pick/pack", "SKU variety high"],
          leadQuery: '("3PL" OR "fulfillment center") packaging',
        },
        {
          name: "Cold Chain",
          description: "Food/pharma with temperature control requirements.",
          indicators: ["mentions: cold, frozen, temperature", "certs: HACCP, GMP"],
          leadQuery: '"cold chain" packaging',
        },
        {
          name: "Fragile Goods",
          description: "Electronics/glassware needing protective materials.",
          indicators: ["mentions: fragile, foam, bubble"],
          leadQuery: '"fragile goods" packaging',
        },
      ],
    };
  }

  const model =
    process.env.OPENROUTER_MODEL ||
    "meta-llama/llama-3.1-8b-instruct:free"; // prefer cheap/free tier

  const system = `You are a B2B buyer-persona inference engine.
Return STRICT JSON matching this TypeScript type (no code fences):
{
  "latents": {
    "IrregularLoadLikelihood": number, "ColdChainSensitivity": number, "FragilityRisk": number,
    "SustainabilityPriority": number, "Seasonality": number, "OrderSizeVariability": number, "Notes": string
  },
  "archetypes": Array<{ "name": string, "description": string, "indicators": string[], "leadQuery": string }>
}
All numbers in [0,1]. Keep tokens short.`;

  const user = {
    supplierDomain,
    title: sig.title,
    headings: (sig.headings || []).slice(0, 8),
    keywords: sig.keywords,
    certifications: sig.certifications,
    services: (sig.services || []).slice(0, 5),
    hints: {
      skuHints: (sig.skuHints || []).length,
      locations: (sig.locations || []).length,
      hiring: (sig.hiringHints || []).length,
    },
    sample: (sig.siteTextSample || "").slice(0, 400),
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/", // optional, helps dashboard
      "X-Title": "buyers-autofix",
    } as any,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            "Supplier observables:\n" + JSON.stringify(user, null, 2) + "\nReturn JSON only.",
        },
      ],
      temperature: 0.2,
      max_tokens: 500,
    }),
  } as any);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${txt}`);
  }
  const data: any = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Try to salvage JSON substring
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  const latents: Latents = parsed.latents || cheapHeuristicLatents(sig);
  const archetypes: Archetype[] =
    parsed.archetypes && Array.isArray(parsed.archetypes) && parsed.archetypes.length
      ? parsed.archetypes.slice(0, 5)
      : [
          {
            name: "General Industrial",
            description: "Factories needing corrugated, tape, and stretch film.",
            indicators: ["mentions: pallet, corrugated, shrink"],
            leadQuery: "industrial packaging supplier",
          },
        ];

  return { latents, archetypes };
}

function defaultCandidateSources(): CandidateSource[] {
  return [
    {
      id: "DUCKDUCKGO",
      kind: "SEARCH",
      description: "DuckDuckGo HTML results (no API key).",
      urlTemplate: "https://duckduckgo.com/html/?q={query}",
      query: '("packaging" OR "packaging supplier" OR "packaging distributor") {region}',
    },
    {
      id: "KOMPASS",
      kind: "DIRECTORY",
      description: "Kompass directory search (public pages).",
      urlTemplate:
        "https://www.kompass.com/en/searchCompanies/?searchType=SUPPLIER&text={query}",
      query: "packaging",
    },
    {
      id: "EUROPAGES",
      kind: "DIRECTORY",
      description: "EUROPAGES B2B directory.",
      urlTemplate: "https://www.europages.co.uk/companies/{query}.html",
      query: "packaging",
    },
    {
      id: "THOMASNET",
      kind: "DIRECTORY",
      description: "Thomasnet (US) directory.",
      urlTemplate: "https://www.thomasnet.com/search.html?what={query}",
      query: "packaging",
    },
  ];
}

// ---- Public entry

export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryOutput> {
  const { supplier, region, persona } = input;
  if (!supplier) {
    throw new Error("supplier is required");
  }
  const { domain, url } = normalizeSupplierURL(supplier);

  const cacheKey = crypto.createHash("sha1").update(`${domain}|${region || ""}`).digest("hex");
  const cached = cacheGet(cacheKey);
  if (cached) {
    emitEvidence(
      {
        at: new Date().toISOString(),
        stage: "discovery",
        supplier: domain,
        topic: "cache_hit",
        detail: { cacheKey },
        source: "DISCOVERY",
      },
      undefined
    );
    return { ...cached, cached: true, persona: persona ?? cached.persona };
  }

  // Fetch homepage
  let html = "";
  try {
    html = await fetchText(url, 10_000);
  } catch (e) {
    emitEvidence(
      {
        at: new Date().toISOString(),
        stage: "discovery",
        supplier: domain,
        topic: "fetch_error",
        detail: { message: (e as Error).message, url },
        source: "DISCOVERY",
      },
      undefined
    );
    // Continue with minimal HTML so we still produce something
    html = `<html><title>${domain}</title><body>${domain}</body></html>`;
  }

  const signals = deriveSignals(html);
  emitEvidence(
    {
      at: new Date().toISOString(),
      stage: "discovery",
      supplier: domain,
      topic: "signals",
      detail: {
        title: signals.title,
        hCount: signals.headings?.length || 0,
        keywords: Object.keys(signals.keywords || {}),
        locations: signals.locations,
        certs: signals.certifications,
      },
      source: "DISCOVERY",
    },
    undefined
  );

  // LLM (cheap) hypothesis
  let latents: Latents;
  let archetypes: Archetype[];
  try {
    const out = await callOpenRouter(signals, domain);
    latents = out.latents;
    archetypes = out.archetypes;
  } catch (e) {
    emitEvidence(
      {
        at: new Date().toISOString(),
        stage: "discovery",
        supplier: domain,
        topic: "openrouter_error",
        detail: { message: (e as Error).message },
        source: "DISCOVERY",
      },
      undefined
    );
    latents = cheapHeuristicLatents(signals);
    archetypes = [
      {
        name: "General Industrial",
        description: "Fallback archetype.",
        indicators: [],
        leadQuery: "industrial packaging supplier",
      },
    ];
  }

  const candidateSources = defaultCandidateSources();

  const output: DiscoveryOutput = {
    supplierDomain: domain,
    normalizedURL: url,
    cached: false,
    signals,
    latents,
    archetypes,
    candidateSources: candidateSources,
    persona: persona ?? {
      inferredFrom: domain,
      latents,
      archetypes: archetypes.map((a) => a.name),
    },
  };

  cacheSet(cacheKey, output);

  emitEvidence(
    {
      at: new Date().toISOString(),
      stage: "discovery",
      supplier: domain,
      topic: "persona_hypothesis",
      detail: { latents, archetypes },
      source: "DISCOVERY",
    },
    undefined
  );

  return output;
}

export default runDiscovery;
