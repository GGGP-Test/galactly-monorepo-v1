/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Providers barrel + tiny pipeline.
 * Works whether ./seeds, ./websearch, ./scorer export default or named fns.
 */

/* Re-export TYPES so other modules can do:
   import { Candidate, ... } from "../providers" */
export type {
  Candidate,
  BuyerCandidate,
  DiscoveryArgs,
  ScoreOptions,
  ScoredCandidate,
  WebSearchQuery,
  WebSearchResult,
  Seed,
  SeedsOutput,
  FindBuyersInput, // <- some services import this via "../providers"
} from "./types";

import * as SeedsMod from "./seeds";
import * as SearchMod from "./websearch";
import * as ScorerMod from "./scorer";

type ProviderFn = (...args: any[]) => any | Promise<any>;
const isFn = (v: any): v is ProviderFn => typeof v === "function";

function pick(mod: any, names: string[]): ProviderFn | undefined {
  if (!mod) return undefined;
  for (const n of ["default", ...names]) {
    const v = (mod as any)[n];
    if (typeof v === "function") return v;
  }
  if (typeof mod === "function") return mod;
  return undefined;
}

/* Resolve provider functions (accept default or named) */
export const seeds = pick(SeedsMod, ["seeds", "getSeeds", "provider"]);
export const websearch = pick(SearchMod, ["websearch", "search", "provider"]);
export const scorer = pick(ScorerMod, ["scorer", "score", "provider"]);

/* Public registry (kept for compatibility) */
export const providers = { seeds, websearch, scorer };

/**
 * Minimal pipeline.
 * NOTE: returns an object { candidates, meta } because services expect ".candidates".
 */
export async function generateAndScoreCandidates(
  ctx: any = {}
): Promise<{ candidates: any[]; meta: Record<string, any> }> {
  const limit = ctx?.limitPerSeed ?? 5;

  // 1) Seeds
  let seedItems: any[] = [];
  let seedMode = "none";
  if (isFn(seeds)) {
    const out = await seeds(undefined, ctx);
    if (Array.isArray(out?.seeds)) {
      seedItems = out.seeds;
      seedMode = "object.seeds";
    } else if (Array.isArray(out)) {
      seedItems = out;
      seedMode = "array";
    }
  }

  // 2) Web search
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

  // 3) Score (optional)
  if (isFn(scorer)) {
    const scored = await scorer(candidates, ctx?.scoreOptions ?? undefined, ctx);
    if (Array.isArray(scored)) {
      return {
        candidates: scored,
        meta: {
          step: "scored",
          seedMode,
          seedCount: seedItems.length,
          candidateCount: scored.length,
          generatedAt: new Date().toISOString(),
        },
      };
    }
  }

  return {
    candidates,
    meta: {
      step: "searched",
      seedMode,
      seedCount: seedItems.length,
      candidateCount: candidates.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

/* Alias some code imports */
export const runProviders = generateAndScoreCandidates;

/* Default export */
export default providers;