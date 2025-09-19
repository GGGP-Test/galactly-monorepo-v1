/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Providers barrel + tiny pipeline.
 * Safe with either default or named exports in ./seeds, ./websearch, ./scorer.
 */

/* Re-export TYPES so other modules can do: import { Candidate, ... } from "../providers" */
export type {
  Candidate,
  BuyerCandidate,
  DiscoveryArgs,
  ScoreOptions,
  ScoredCandidate,
  WebSearchQuery,
  Seed,
  SeedsOutput,
  WebSearchResult,
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

/* Minimal pipeline; safe if any step is missing. */
export async function generateAndScoreCandidates(ctx: any = {}): Promise<any[]> {
  const limit = ctx?.limitPerSeed ?? 5;

  // 1) seeds
  let seedItems: any[] = [];
  if (isFn(seeds)) {
    const out = await seeds(undefined, ctx);
    if (Array.isArray(out?.seeds)) seedItems = out.seeds;
    else if (Array.isArray(out)) seedItems = out;
  }

  // 2) websearch
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
  if (isFn(scorer)) {
    const scored = await scorer(candidates, ctx?.scoreOptions ?? undefined, ctx);
    if (Array.isArray(scored)) return scored;
  }
  return candidates;
}

/* Compatibility alias some code may import */
export const runProviders = generateAndScoreCandidates;

/* Default export */
export default providers;