// Path: Backend/src/providers/index.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal, static-import version so TypeScript stops yelling.
 * We assume these files exist in the same folder:
 *   - ./seeds.ts
 *   - ./websearch.ts
 *   - ./scorer.ts
 * If any of them exports a default function, or a named one, we pick it.
 */

import * as SeedsMod from "./seeds";
import * as SearchMod from "./websearch";
import * as ScorerMod from "./scorer";

export type Providers = {
  seeds?: (...args: any[]) => Promise<any>;
  websearch?: (...args: any[]) => Promise<any>;
  scorer?: (...args: any[]) => Promise<any>;
};

const isFn = (v: any): v is (...a: any[]) => any => typeof v === "function";

function pick(mod: any, keys: string[]): any | undefined {
  if (!mod) return undefined;
  // prefer default, but accept a few conventional names
  for (const k of ["default", ...keys]) {
    const v = (mod as any)[k];
    if (isFn(v)) return v;
  }
  // if the module itself is callable (rare), use it
  if (isFn(mod)) return mod;
  return undefined;
}

const seedsProvider =
  pick(SeedsMod, ["seeds", "getSeeds", "provider"]) as Providers["seeds"];
const websearchProvider =
  pick(SearchMod, ["websearch", "search", "provider"]) as Providers["websearch"];
const scorerProvider =
  pick(ScorerMod, ["scorer", "score", "provider"]) as Providers["scorer"];

let _providers: Providers = {
  seeds: seedsProvider,
  websearch: websearchProvider,
  scorer: scorerProvider,
};

export function setProviders(p: Providers) {
  _providers = p;
}

export function getProviders(): Providers {
  return _providers;
}

/**
 * Orchestrates the pipeline in-order:
 *   1) seeds -> 2) websearch -> 3) scorer
 * Returns scored candidates if a scorer exists, otherwise raw candidates.
 */
export async function generateAndScoreCandidates(ctx: any = {}): Promise<any[]> {
  const { seeds, websearch, scorer } = _providers;

  // 1) get seeds
  let seedItems: any[] = [];
  if (isFn(seeds)) {
    const out = await seeds(undefined, ctx);
    if (Array.isArray(out?.seeds)) seedItems = out.seeds;
    else if (Array.isArray(out)) seedItems = out;
  }

  // 2) search for each seed
  const limit = ctx?.limitPerSeed ?? 5;
  const candidates: any[] = [];
  if (isFn(websearch) && seedItems.length) {
    for (const s of seedItems) {
      const q = s?.query ?? s;
      const results = await websearch({ query: q, limit }, ctx);
      if (Array.isArray(results)) {
        for (const r of results) {
          candidates.push({
            host: r.host ?? r.domain ?? null,
            url: r.url ?? r.link ?? r.href ?? null,
            title: r.title ?? r.pageTitle ?? null,
            tags: s?.tags ?? [],
            extra: { snippet: r.snippet ?? r.summary ?? null, source: "websearch" },
          });
        }
      }
    }
  }

  // 3) score (optional)
  if (!isFn(scorer)) return candidates;
  const scored = await scorer(candidates, ctx?.scoreOptions ?? undefined, ctx);
  return Array.isArray(scored) ? scored : candidates;
}

// Re-export local types if present so external code can do `import {...} from "./providers"`
export * from "./types";

// Default export for convenience
export default {
  getProviders,
  setProviders,
  generateAndScoreCandidates,
};