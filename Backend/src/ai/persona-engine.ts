import { METRIC_SEEDS, PHRASE_TO_METRICS, MetricId } from "./metric-dictionary";

export interface PersonaMetric {
  id: MetricId;
  prior: number;          // prior belief (0..1)
  evidence: number;       // observed signal strength (0..1)
  posterior: number;      // fused score
  why: string[];          // snippets/keywords that triggered it
}

export interface Persona {
  domain: string;
  metrics: PersonaMetric[];
  top: MetricId[];          // sorted by posterior
  tags: string[];           // human-readable hints
  version: string;
}

export interface Snapshot {
  domain: string;
  title?: string;
  meta?: string[];
  text: string[];           // tokenized visible text (lowercased)
  links: string[];          // visible outbound links/hostnames (lowercased)
}

/** Utility: normalize hostname from input */
export function normalizeDomain(input: string): string {
  try {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return "";
    if (trimmed.includes("://")) {
      const u = new URL(trimmed);
      return u.hostname.replace(/^www\./, "");
    }
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  } catch {
    return input.trim().toLowerCase();
  }
}

/** Very cheap HTML→Snapshot reducer (no external deps). */
export function htmlToSnapshot(domain: string, html?: string): Snapshot {
  const text: string[] = [];
  const links: string[] = [];
  const meta: string[] = [];

  if (html) {
    const lower = html.toLowerCase();

    // strip script/style quickly
    const stripped = lower
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ");

    // meta tags
    const metaMatches = stripped.match(/<meta[^>]+(name|property)="[^"]+"[^>]+content="[^"]+"[^>]*>/g) || [];
    for (const m of metaMatches) {
      const c = (m.match(/content="([^"]+)"/) || [])[1];
      if (c) meta.push(c);
    }

    // visible text (very rough)
    stripped
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/g)
      .filter(Boolean)
      .forEach((w) => text.push(w));

    // links
    const hrefs = stripped.match(/href="([^"]+)"/g) || [];
    for (const h of hrefs) {
      const url = h.slice(6, -1);
      try {
        const u = new URL(url, "https://" + domain);
        links.push(u.hostname.replace(/^www\./, ""));
      } catch { /* ignore */ }
    }
  }

  return { domain, text, links, meta };
}

/** Heuristic scoring: count phrase hits, combine with priors via simple fusion. */
function scoreWithHeuristics(snap: Snapshot) {
  const counts: Record<MetricId, number> = Object.create(null);
  const why: Record<MetricId, string[]> = Object.create(null);

  const corpus: string[] = [
    ...(snap.meta || []),
    ...snap.text,
    ...snap.links
  ].map((t) => t.toLowerCase());

  // exact phrase matches (cheap)
  for (const token of corpus) {
    const metrics = PHRASE_TO_METRICS[token];
    if (!metrics) continue;
    for (const m of metrics) {
      counts[m] = (counts[m] || 0) + 1;
      if (!why[m]) why[m] = [];
      if (why[m].length < 8) why[m].push(token);
    }
  }

  // convert to [0..1] evidence with log dampening
  const metrics = METRIC_SEEDS.map((seed) => {
    const c = counts[seed.id] || 0;
    const evidence = c === 0 ? 0 : 1 - Math.exp(-c / 3);
    const prior = seed.weight;
    // a cheap Bayesian-ish fusion (not rigorous, but monotonic and bounded)
    const posterior = 1 - (1 - prior) * (1 - evidence);
    return {
      id: seed.id,
      prior,
      evidence,
      posterior,
      why: (why[seed.id] || []).slice(0, 8)
    };
  });

  metrics.sort((a, b) => b.posterior - a.posterior);
  const top = metrics.slice(0, 5).map((m) => m.id);

  // lightweight tags
  const tags: string[] = [];
  for (const m of metrics.slice(0, 5)) {
    if (m.posterior >= 0.35) tags.push(`${m.id}:${m.posterior.toFixed(2)}`);
  }

  return { metrics, top, tags };
}

/** Optional OpenRouter refinement with JSON output, guarded and budgeted. */
async function refineWithOpenRouter(
  persona: ReturnType<typeof scoreWithHeuristics>,
  snap: Snapshot,
  opts: { apiKey?: string; model?: string; timeoutMs?: number }
) {
  if (!opts.apiKey) return persona; // skip if not configured

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3500);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
        // Optional best-practice headers for OpenRouter
        "HTTP-Referer": "https://gggp-test.github.io",
        "X-Title": "Galactly Persona Engine"
      },
      body: JSON.stringify({
        model: opts.model || "openai/gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an industrial packaging signal detector. " +
              "Return ONLY JSON with {boosts:[{id,delta,why[]}]} where id is one of " +
              "[ILL,CCI,DFS,RPI,FEI,SUS,CWB,STR,TAP,FNB,HCP,3PL,HAZ,BUL,LTL,ECO]. " +
              "delta in [-0.2, +0.2]. Don't invent new ids."
          },
          {
            role: "user",
            content:
              `Domain: ${snap.domain}\n` +
              `Top heuristic metrics: ${persona.top.join(",")}\n` +
              `Meta: ${(snap.meta || []).slice(0, 10).join(" | ")}\n` +
              `Links: ${snap.links.slice(0, 10).join(",")}\n` +
              `Sample text: ${snap.text.slice(0, 80).join(" ")}`
          }
        ]
      })
    });

    clearTimeout(t);
    if (!res.ok) return persona;

    const data = await res.json() as any;
    const boosts: { id: string; delta: number; why?: string[] }[] =
      data?.choices?.[0]?.message?.content
        ? JSON.parse(data.choices[0].message.content).boosts || []
        : (data?.boosts || []);

    if (!Array.isArray(boosts)) return persona;

    // apply bounded deltas
    const byId: Record<string, number> = Object.create(null);
    const why: Record<string, string[]> = Object.create(null);
    for (const b of boosts) {
      if (!b || typeof b.id !== "string") continue;
      const id = b.id as MetricId;
      const delta = Math.max(-0.2, Math.min(0.2, Number(b.delta) || 0));
      byId[id] = (byId[id] || 0) + delta;
      if (b.why && Array.isArray(b.why)) {
        why[id] = (why[id] || []).concat(b.why).slice(0, 8);
      }
    }

    const metrics = persona.metrics.map((m) => {
      const adj = Math.max(0, Math.min(1, m.posterior + (byId[m.id] || 0)));
      const whyMerged = m.why.concat(why[m.id] || []);
      return { ...m, posterior: adj, why: whyMerged.slice(0, 8) };
    });

    metrics.sort((a, b) => b.posterior - a.posterior);
    const top = metrics.slice(0, 5).map((m) => m.id);
    const tags = metrics.slice(0, 5).map((m) => `${m.id}:${m.posterior.toFixed(2)}`);
    return { metrics, top, tags };
  } catch {
    clearTimeout(t);
    return persona;
  }
}

export class PersonaEngine {
  private cache = new Map<string, Persona>(); // in-memory; swap to DB later

  constructor(private opts?: { openRouterKey?: string; openRouterModel?: string }) {}

  /** Snapshot HTML (if provided), score heuristically, then optionally refine with LLM. */
  async infer(domainInput: string, html?: string): Promise<Persona> {
    const domain = normalizeDomain(domainInput);
    if (!domain) throw new Error("domain is required");

    const cached = this.cache.get(domain);
    if (cached) return cached;

    const snap = htmlToSnapshot(domain, html);
    const base = scoreWithHeuristics(snap);
    const refined = await refineWithOpenRouter(base, snap, {
      apiKey: this.opts?.openRouterKey || process.env.OPENROUTER_API_KEY,
      model: this.opts?.openRouterModel || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      timeoutMs: 3500
    });

    const persona: Persona = {
      domain,
      metrics: refined.metrics,
      top: refined.top,
      tags: refined.tags,
      version: "v1"
    };

    this.cache.set(domain, persona);
    return persona;
  }
}
