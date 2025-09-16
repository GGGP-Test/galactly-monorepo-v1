/* Buyer discovery (cheap-first with optional 1 LLM hop)
 *
 * Produces:
 *  - persona one-liner (X sell to Y; talk to Z) with confidence
 *  - latent metric estimates (ILL, FEI, DFS, SCP, CCI, RPI)
 *  - signals & evidence trail
 *  - candidate search queries for free directories/search (to be used by pipeline)
 *
 * LLM provider order (optional): Gemini -> HF -> Groq (0 or 1 call total, cached by hash)
 * Env:
 *   GEMINI_API_KEY, HF_API_TOKEN, GROQ_API_KEY
 */

import crypto from "crypto";

// ----- Types -----
export type DiscoveryInput = {
  supplier: string;          // domain or URL (e.g. "peakpackaging.com" or "https://peakpackaging.com")
  region?: string;           // "US" | "CA" | etc. (optional)
  personaInput?: string;     // user-supplied persona text (we weight ~90% by default if present)
};

export type Evidence = {
  kind: string;              // "fetch","parse","metric","llm","assumption"
  note: string;
  url?: string;
  ts: number;
};

export type Persona = {
  oneLiner: string;          // "You are <X>. You sell to <Y>. Talk to <Z>."
  buyerTitles: string[];     // target titles
  sectors: string[];         // e.g., ["e-commerce", "3PL", "DTC retail"]
  why: string[];             // short bullets for UI
  confidence: number;        // 0..1
};

export type Metrics = {
  ILL?: number; // Irregular Load Likelihood
  FEI?: number; // Fragility Exposure Index
  DFS?: number; // DTC Footprint Score
  SCP?: number; // Sustainability Cost Pressure
  CCI?: number; // Cold-Chain Importance
  RPI?: number; // Right-Size Pressure Index
};

export type DiscoveryOutput = {
  supplierDomain: string;
  persona: Persona;
  metrics: Metrics;
  signals: Record<string, any>;
  candidateSourceQueries: Array<{ source: string; q: string; region?: string }>;
  evidence: Evidence[];
};

// -------- Utilities --------

const now = () => Date.now();

function normalizeDomain(input: string): { url: string; domain: string } {
  let t = input.trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  try {
    const u = new URL(t);
    const domain = (u.hostname || "").replace(/^www\./, "");
    return { url: `https://${domain}`, domain };
  } catch {
    // very broken input — treat as domain only
    const domain = input.replace(/^https?:\/\//, "").replace(/^www\./, "");
    return { url: `https://${domain}`, domain };
  }
}

async function safeFetch(url: string): Promise<{ ok: boolean; html: string; finalUrl: string; status?: number }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ArtemisBot/1.0; +https://example.com/bot)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    } as any);
    const html = await res.text();
    return { ok: res.ok, html, finalUrl: res.url, status: res.status };
  } catch {
    return { ok: false, html: "", finalUrl: url };
  }
}

function stripTags(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const text = noScript.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

function scoreBoolean(cond: boolean, w = 1): number {
  return cond ? w : 0;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// ---------- Signal extraction (cheap) ----------

function extractSignals(finalUrl: string, html: string) {
  const text = stripTags(html).toLowerCase();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];

  // Product/service cues
  const cues = {
    stretchFilm: /stretch\s*(film|wrap)/i.test(html),
    shrink: /shrink\s*(wrap|film)/i.test(html),
    corrugated: /corrugat(ed|ion|e)?\s*(box|carton|pack|sheet)?/i.test(html),
    labels: /\blabels?\b/i.test(html),
    flexible: /flexible\s*packaging/i.test(html),
    rightSizing: /right-?siz(e|ing)/i.test(html),
    cartonization: /cartoniz(e|ation)/i.test(html),
    ista: /\bista-?\d\b/i.test(html),
    coldChain: /(cold[-\s]?chain|refrigerated|temperature[-\s]?controlled|frozen)/i.test(html),
    ecommerce: /(e-?com(merce)?|shopify|woocommerce|returns\s*portal)/i.test(html),
    threePL: /\b3pl\b/i.test(html),
    pallet: /\bpallet(izing|ization|s)?\b/i.test(html),
    fragile: /\bfragile|glass|damage\s*reduction|shock\s*protection\b/i.test(html),
    sustainability: /(eco|recyclable|sustainable|sustainability|post[-\s]?consumer)/i.test(html),
    automation: /(auto(mat(?:ion|ic))|turntable|pre-?stretch|wrapper|wrapping\s*machine)/i.test(html),
  };

  // Very rough geo/locations hint
  const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(text);
  const hasState = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/.test(
    text.toUpperCase()
  );
  const multiLocationMentions = /\b(locations|warehouses|distribution\s*centers)\b/i.test(text);

  // SKU-ish density (very rough): count of product cards by repeating words
  const skuDensity =
    (text.match(/\b(products?|catalog|sku|add\s*to\s*cart|case\s*study|datasheet)\b/gi) || []).length / 50;

  const head = (titleMatch?.[1] || "").trim();
  const desc = (metaDesc || "").trim();

  return {
    url: finalUrl,
    title: head,
    description: desc,
    cues,
    geo: { hasZip, hasState, multiLocationMentions },
    skuDensity,
    rawLength: html.length,
  };
}

// ---------- Heuristic persona & metrics ----------

function heuristics(signals: ReturnType<typeof extractSignals>, userPersona?: string) {
  // Latent metrics (0..1) from cues
  const c = signals.cues;

  const ILL = clamp01(
    scoreBoolean(c.pallet, 0.25) +
    scoreBoolean(c.automation, 0.25) +
    scoreBoolean(c.threePL, 0.25) +
    (signals.geo.multiLocationMentions ? 0.25 : 0)
  );

  const FEI = clamp01(
    scoreBoolean(c.fragile, 0.4) + scoreBoolean(c.ista, 0.3) + scoreBoolean(c.rightSizing, 0.2)
  );

  const DFS = clamp01(scoreBoolean(c.ecommerce, 0.6) + (signals.skuDensity > 0.4 ? 0.3 : 0));

  const SCP = clamp01(scoreBoolean(c.sustainability, 0.6));

  const CCI = clamp01(scoreBoolean(c.coldChain, 0.8));

  const RPI = clamp01(scoreBoolean(c.rightSizing, 0.6) + scoreBoolean(c.cartonization, 0.3));

  // Buyer titles selection
  const titles = new Set<string>();
  if (c.ecommerce || RPI > 0.4) titles.add("Fulfillment Operations Manager");
  if (ILL > 0.4 || c.pallet || c.automation) titles.add("Warehouse Operations Manager");
  if (c.corrugated || RPI > 0.4) titles.add("Packaging Engineer");
  if (DFS > 0.3 || c.ecommerce) titles.add("E-commerce Operations");
  if (CCI > 0.3) titles.add("Cold-Chain Logistics Manager");
  if (FEI > 0.3) titles.add("Quality / Damage Reduction Lead");
  titles.add("Purchasing Manager");

  // Sector guess
  const sectors: string[] = [];
  if (c.ecommerce) sectors.push("DTC / E-commerce");
  if (c.threePL) sectors.push("3PL / Fulfillment");
  if (c.coldChain) sectors.push("Cold-Chain");
  if ((c.corrugated || c.labels || c.flexible) && sectors.length === 0) sectors.push("General Packaging");

  // Company "offer" summary (cheap)
  const offerBits: string[] = [];
  if (c.corrugated) offerBits.push("corrugated");
  if (c.flexible) offerBits.push("flexible packaging");
  if (c.labels) offerBits.push("labels");
  if (c.stretchFilm || c.shrink) offerBits.push("stretch/shrink film");
  if (c.automation) offerBits.push("wrapping machines");
  if (offerBits.length === 0) offerBits.push("packaging solutions");

  // Persona one-liner template
  const baseOneLiner = `You are a ${offerBits.join(", ")} supplier. You sell mostly to ${sectors[0] || "operations teams"}; talk to ${Array.from(titles)[0]}.`;

  // If user provided persona, weight it at 90% and blend
  const personaOneLiner = userPersona
    ? blendOneLiner(userPersona, baseOneLiner, 0.9)
    : baseOneLiner;

  // Confidence from richness of cues
  const cueHits = Object.values(c).filter(Boolean).length;
  const confidence = clamp01(0.3 + 0.05 * cueHits + (signals.rawLength > 20000 ? 0.05 : 0));

  const why: string[] = [];
  if (c.ecommerce) why.push("site mentions e-commerce/Shopify/returns");
  if (c.automation) why.push("mentions wrappers/turntables/automation");
  if (c.corrugated) why.push("corrugated/case/carton keywords");
  if (c.rightSizing) why.push("right-size/cartonization cues");
  if (c.coldChain) why.push("cold-chain/temperature control");
  if (c.ista) why.push("ISTA compliance named");
  if (c.sustainability) why.push("sustainable/recyclable claims");

  const persona: Persona = {
    oneLiner: personaOneLiner,
    buyerTitles: Array.from(titles),
    sectors,
    why,
    confidence,
  };

  const metrics: Metrics = { ILL, FEI, DFS, SCP, CCI, RPI };

  return { persona, metrics };
}

function blendOneLiner(user: string, auto: string, userWeight = 0.9) {
  // Very simple: keep user's nouns if present; otherwise fall back to auto template.
  // We also show "(auto-check: ...)" tail when we overrode.
  const trimmed = user.trim();
  if (!trimmed) return auto;
  const tail = auto.replace(/^You are a\s*/i, "").trim();
  return `${trimmed} (auto-check: ${tail})`;
}

// ---------- Optional: 1 cheap LLM hypothesis (JSON) ----------

async function tryLLMOnce(
  supplierDomain: string,
  signals: ReturnType<typeof extractSignals>,
  personaDraft: Persona,
  metricsDraft: Metrics,
  evidence: Evidence[]
): Promise<{ persona?: Persona; metrics?: Metrics }> {
  const payload = {
    supplierDomain,
    hints: {
      title: signals.title,
      description: signals.description,
      cues: signals.cues,
      geo: signals.geo,
    },
    draft: {
      persona: personaDraft,
      metrics: metricsDraft,
    },
    schema: {
      type: "object",
      properties: {
        persona: {
          type: "object",
          properties: {
            oneLiner: { type: "string" },
            buyerTitles: { type: "array", items: { type: "string" } },
            sectors: { type: "array", items: { type: "string" } },
            why: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
          },
          required: ["oneLiner", "buyerTitles", "confidence"],
        },
        metrics: {
          type: "object",
          properties: {
            ILL: { type: "number" },
            FEI: { type: "number" },
            DFS: { type: "number" },
            SCP: { type: "number" },
            CCI: { type: "number" },
            RPI: { type: "number" },
          },
        },
      },
      required: ["persona", "metrics"],
    },
  };

  const prompt =
    `You are helping infer a supplier's buyer persona and latent logistics metrics from website cues.\n` +
    `Return STRICT JSON only (no prose). Improve the draft if needed, but keep it realistic and cheap.\n` +
    `Be concise; one-liner should follow: "You are X. You sell to Y. Talk to Z."\n` +
    `JSON keys: persona { oneLiner, buyerTitles[], sectors[], why[], confidence }, metrics {ILL,FEI,DFS,SCP,CCI,RPI}.\n` +
    `Input:\n` + JSON.stringify(payload);

  // Choose first available provider (Gemini -> HF -> Groq)
  const gem = process.env.GEMINI_API_KEY;
  const hf = process.env.HF_API_TOKEN;
  const groq = process.env.GROQ_API_KEY;

  let jsonText: string | null = null;

  try {
    if (gem) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${gem}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, topK: 32, topP: 0.9, maxOutputTokens: 500 },
          }),
        } as any
      );
      const data: any = await res.json();
      jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      evidence.push({ kind: "llm", note: `Gemini used: ${res.status}`, ts: now() });
    } else if (hf) {
      // HF Inference (text-generation; choose a free instruct model)
      const model = process.env.HF_MODEL || "google/gemma-2-9b-it";
      const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hf}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 400, temperature: 0.2 } }),
      } as any);
      const data: any = await res.json();
      jsonText = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text || null;
      evidence.push({ kind: "llm", note: `HF used: ${res.status}`, ts: now() });
    } else if (groq) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groq}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 500,
        }),
      } as any);
      const data: any = await res.json();
      jsonText = data?.choices?.[0]?.message?.content || null;
      evidence.push({ kind: "llm", note: `Groq used: ${res.status}`, ts: now() });
    }
  } catch (e: any) {
    evidence.push({ kind: "llm", note: `provider error ${e?.message || e}`, ts: now() });
  }

  if (!jsonText) return {};

  // Extract JSON from backticks or prose if provider added fluff
  const jsonMatch = jsonText.match(/\{[\s\S]*\}$/);
  const jsonStr = jsonMatch ? jsonMatch[0] : jsonText;

  try {
    const parsed = JSON.parse(jsonStr);
    // Mild sanity
    if (parsed?.persona?.oneLiner) {
      return { persona: parsed.persona, metrics: parsed.metrics || {} };
    }
  } catch {
    evidence.push({ kind: "llm", note: "failed to parse JSON", ts: now() });
  }
  return {};
}

// ---------- Candidate search queries (free-friendly) ----------

function buildCandidateQueries(domain: string, persona: Persona, region?: string) {
  const vendor = domain.replace(/^www\./, "");
  const loc = region || "US";

  // Directories/search we can scrape cheaply via HTML later (pipeline.ts will choose)
  const queries = [
    { source: "duckduckgo", q: `site:thomasnet.com buyers "${vendor}"`, region: loc },
    { source: "duckduckgo", q: `("packaging buyer" OR "purchasing manager") (warehouse OR fulfillment) ${loc}` },
    { source: "duckduckgo", q: `("procurement" OR "sourcing") packaging ${loc} ("${(persona.sectors[0] || "3PL").replace(/"/g, "")}")` },
    { source: "duckduckgo", q: `("RFQ" OR "request for quote") packaging ${loc}` },
    { source: "duckduckgo", q: `("distribution center" OR 3PL) "packaging" ${loc}` },
  ];

  return queries;
}

// ---------- (Optional) BleedStore integration (best-effort) ----------

type BleedLike = {
  appendDecision?: (e: any) => void;
  appendEvidence?: (e: any) => void;
};

function pushEvidence(store: BleedLike | undefined, ev: Evidence) {
  try {
    store?.appendEvidence?.(ev);
  } catch {
    /* ignore */
  }
}

// ---------- Cache key ----------

function cacheKey(domain: string, html: string, personaInput?: string) {
  const h = crypto.createHash("sha1");
  h.update(domain);
  h.update(String(html.length));
  if (personaInput) h.update(personaInput);
  return h.digest("hex");
}

// ---------- Public API ----------

export async function discoverSupplier(
  input: DiscoveryInput,
  bleed?: BleedLike
): Promise<DiscoveryOutput> {
  const evidence: Evidence[] = [];
  const { url, domain } = normalizeDomain(input.supplier);

  const fetched = await safeFetch(url);
  evidence.push({
    kind: "fetch",
    note: `GET ${fetched.finalUrl} -> ${fetched.status || 0}, ok=${fetched.ok}`,
    url: fetched.finalUrl,
    ts: now(),
  });

  if (!fetched.ok || !fetched.html) {
    // Minimal fallback persona when site is unreachable
    const fallbackPersona: Persona = {
      oneLiner:
        input.personaInput?.trim() ||
        "You are a packaging supplier. You sell to operations teams; talk to Purchasing Manager.",
      buyerTitles: ["Purchasing Manager", "Operations Manager"],
      sectors: ["General Packaging"],
      why: ["site unreachable; using safe fallback"],
      confidence: 0.3,
    };
    const metrics: Metrics = { ILL: 0.2, DFS: 0.2, FEI: 0.2, SCP: 0.1, CCI: 0.1, RPI: 0.2 };
    const queries = buildCandidateQueries(domain, fallbackPersona, input.region);

    evidence.push({ kind: "assumption", note: "unreachable -> fallback persona", ts: now() });
    pushEvidence(bleed, evidence[evidence.length - 1]);

    return {
      supplierDomain: domain,
      persona: fallbackPersona,
      metrics,
      signals: {},
      candidateSourceQueries: queries,
      evidence,
    };
  }

  const signals = extractSignals(fetched.finalUrl, fetched.html);

  // Heuristic first (free)
  const { persona: draftPersona, metrics: draftMetrics } = heuristics(signals, input.personaInput);

  evidence.push({
    kind: "parse",
    note: `signals: ${JSON.stringify({ title: signals.title, cues: signals.cues })}`,
    url: signals.url,
    ts: now(),
  });
  pushEvidence(bleed, evidence[evidence.length - 1]);

  // One optional LLM refinement (if keys exist)
  let persona = draftPersona;
  let metrics = draftMetrics;

  const anyProvider = process.env.GEMINI_API_KEY || process.env.HF_API_TOKEN || process.env.GROQ_API_KEY;
  if (anyProvider) {
    const { persona: p2, metrics: m2 } = await tryLLMOnce(domain, signals, draftPersona, draftMetrics, evidence);
    if (p2?.oneLiner) {
      persona = p2;
      metrics = { ...metrics, ...(m2 || {}) };
    }
  }

  // Candidate queries for the pipeline step
  const candidateSourceQueries = buildCandidateQueries(domain, persona, input.region);

  // Emit final evidence
  evidence.push({
    kind: "metric",
    note: `metrics: ${JSON.stringify(metrics)}`,
    ts: now(),
  });
  pushEvidence(bleed, evidence[evidence.length - 1]);

  return {
    supplierDomain: domain,
    persona,
    metrics,
    signals,
    candidateSourceQueries,
    evidence,
  };
}

export default { discoverSupplier };
