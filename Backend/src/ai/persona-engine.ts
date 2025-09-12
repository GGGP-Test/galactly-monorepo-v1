// src/ai/persona-engine.ts
// Builds a supplier Persona from a domain using heuristics + (optional) OpenRouter JSON output.
// No external npm deps. Node 20 fetch only.

import { METRICS, DEFAULT_TITLES, type MetricDef } from "./metric-dictionary";

export interface PersonaMetric {
  key: string;
  label: string;
  weight: number;     // 0..1 confidence/importance
  reason: string;     // one-liner
}

export interface Persona {
  domain: string;
  metrics: PersonaMetric[];
  terms: string[];    // keywords for query planners
  provenance: {
    snapshotChars: number;
    sources: string[];      // e.g. ["https://example.com/"]
    llmUsed?: string;       // openrouter model if used
  };
}

interface Input {
  tenantId: string;
  domain: string;
  region: string;
  allowLLM?: boolean;
  snapshotHTML?: string;
  extraHints?: string[];
}

// ---------- tiny TTL cache (in-memory) ----------
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const cache = new Map<string, { t: number; p: Persona }>();
function keyOf(i: Input) { return `${i.tenantId}::${i.domain.toLowerCase()}`; }

// ---------- public API ----------
export async function inferPersona(i: Input): Promise<Persona> {
  const k = keyOf(i);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.p;

  const { html, src } = await getSnapshot(i);
  const heur = scoreByHeuristics(html);

  let llmMetrics: PersonaMetric[] = [];
  let llmTerms: string[] = [];
  let llmUsed: string | undefined;

  if (i.allowLLM && process.env.OPENROUTER_API_KEY) {
    try {
      const llm = await llmSuggest(html, i.extraHints || []);
      llmMetrics = llm.metrics;
      llmTerms = llm.terms;
      llmUsed = llm.model;
    } catch { /* swallow LLM errors – heuristics still work */ }
  }

  const merged = mergeHeurAndLLM(heur.metrics, llmMetrics);
  const terms = dedupe([
    ...heur.terms.slice(0, 24),
    ...llmTerms.slice(0, 24),
    ...DEFAULT_TITLES
  ]).slice(0, 40);

  const persona: Persona = {
    domain: i.domain.toLowerCase(),
    metrics: merged.slice(0, 6),
    terms,
    provenance: {
      snapshotChars: html.length,
      sources: [src],
      llmUsed
    }
  };

  cache.set(k, { t: Date.now(), p: persona });
  return persona;
}

// ---------- snapshot fetch ----------
async function getSnapshot(i: Input): Promise<{ html: string; src: string }> {
  if (i.snapshotHTML && i.snapshotHTML.trim().length > 200) {
    return { html: sanitize(i.snapshotHTML).slice(0, 80_000), src: `inline:${i.domain}` };
  }
  const urls = [`https://${i.domain}/`, `http://${i.domain}/`];
  for (const u of urls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(u, { signal: ctrl.signal, headers: { "accept": "text/html,*/*" } as any });
      clearTimeout(timer);
      if (r.ok) {
        const text = sanitize(await r.text());
        if (text.length > 200) return { html: text.slice(0, 80_000), src: u };
      }
    } catch { /* try next */ }
  }
  // Last resort – empty snapshot (engine will still rely on hints)
  return { html: "", src: `none:${i.domain}` };
}

function sanitize(s: string) {
  // strip scripts/styles to reduce LLM tokens & noise
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ");
}

// ---------- heuristic scoring ----------
function scoreByHeuristics(html: string): { metrics: PersonaMetric[]; terms: string[] } {
  const text = html.toLowerCase();
  const metrics: PersonaMetric[] = [];

  for (const m of METRICS) {
    const hits = countHits(text, m.triggers);
    if (hits > 0) {
      const weight = Math.max(0.1, Math.min(1, Math.log10(1 + hits) / 1.2)); // smooth scale
      metrics.push({
        key: m.key,
        label: m.label,
        weight,
        reason: `Found ${hits} mention(s) across: ${m.triggers.slice(0, 4).join(", ")}…`
      });
    }
  }

  // crude keywords extraction: title, h1, meta content words > 3 chars
  const kw = extractKeywords(html);
  return { metrics: metrics.sort((a,b)=>b.weight-a.weight), terms: kw };
}

function countHits(text: string, phrases: string[]) {
  let c = 0;
  for (const p of phrases) {
    const re = new RegExp(`\\b${escapeRegex(p)}\\b`, "gi");
    c += (text.match(re) || []).length;
  }
  return c;
}

function extractKeywords(html: string): string[] {
  const m = html.match(/<(title|h1|meta)[^>]*(content="[^"]*"|[^>]*)>/gi) || [];
  const bag = new Map<string, number>();
  for (const tag of m) {
    const chunk = tag.toLowerCase().replace(/<[^>]+>/g, " ").replace(/content="([^"]*)"/, "$1");
    for (const w of chunk.split(/[^a-z0-9+/-]+/g)) {
      if (w.length < 4 || w.length > 24) continue;
      if (/^(home|about|contact|policy|terms|copyright)$/.test(w)) continue;
      bag.set(w, (bag.get(w) || 0) + 1);
    }
  }
  return Array.from(bag.entries()).sort((a,b)=>b[1]-a[1]).map(([w])=>w).slice(0, 40);
}

// ---------- OpenRouter JSON suggester ----------
async function llmSuggest(snapshot: string, hints: string[]) {
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const prompt = [
    {
      role: "system",
      content:
        "You analyze a supplier website snapshot and return STRICT JSON. " +
        "Goal: identify top packaging buyer metrics and relevant search terms. " +
        "Return ONLY JSON with fields: metrics[{key,label,weight,reason}], terms[]. " +
        "Weights in [0,1]. Keep metrics<=6, terms<=24."
    },
    {
      role: "user",
      content:
        JSON.stringify({
          snapshot: snapshot.slice(0, 16_000),
          hints
        })
    }
  ];

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://your.app (persona-engine)",
      "X-Title": "persona-engine"
    } as any,
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: prompt
    })
  });

  if (!r.ok) throw new Error(`openrouter ${r.status}`);
  const data = await r.json();

  const raw = (data?.choices?.[0]?.message?.content || "").trim();
  const parsed = safeParse(raw, { metrics: [], terms: [] });

  // Coerce to known shape, clip, sanitize weights
  const metrics: PersonaMetric[] = (parsed.metrics || []).slice(0, 6).map((m: any) => ({
    key: String(m.key || "").slice(0, 12),
    label: String(m.label || "").slice(0, 80),
    weight: clamp(Number(m.weight), 0, 1),
    reason: String(m.reason || "").slice(0, 140)
  }));

  const terms: string[] = (parsed.terms || []).map((t: any)=>String(t)).filter(Boolean).slice(0, 24);

  return { metrics, terms, model };
}

function safeParse(s: string, d: any) { try { return JSON.parse(s); } catch { return d; } }
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, isFinite(x)?x:0)); }
function dedupe<T>(arr: T[]) { return Array.from(new Set(arr)); }
function escapeRegex(s: string){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ---------- merge logic ----------
function mergeHeurAndLLM(heur: PersonaMetric[], llm: PersonaMetric[]): PersonaMetric[] {
  const byKey = new Map<string, PersonaMetric>();

  const add = (m: PersonaMetric, w: number) => {
    const prev = byKey.get(m.key);
    if (!prev) {
      byKey.set(m.key, { ...m, weight: clamp(m.weight * w, 0, 1) });
    } else {
      prev.weight = clamp(prev.weight + m.weight * w, 0, 1);
      if (!prev.reason && m.reason) prev.reason = m.reason;
      if (!prev.label && m.label) prev.label = m.label;
    }
  };

  // Heuristics have strong prior; LLM adds/modulates.
  heur.forEach(m => add(m, 0.8));
  llm.forEach(m => add(m, 0.5));

  // If LLM produced a key we don't know, keep it (prefix AI:)
  for (const m of llm) {
    if (!METRICS.find(x => x.key === m.key)) {
      const k = `AI:${m.key}`.slice(0, 12);
      const existing = byKey.get(k);
      if (!existing) byKey.set(k, { ...m, key: k, label: m.label || "AI metric" });
    }
  }

  return Array.from(byKey.values()).sort((a,b)=>b.weight-a.weight);
}
