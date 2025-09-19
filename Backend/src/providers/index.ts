/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Providers barrel + tiny pipeline.
 * Works with either default or named exports in ./seeds, ./websearch, ./scorer.
 * Also re-exports commonly-used types.
 */

export type {
  Candidate,
  BuyerCandidate,
  DiscoveryArgs,
  ScoreOptions,
  ScoredCandidate,
  WebSearchQuery,
  WebSearchResult,
  SeedsOutput,
  RunProvidersMeta,
  RunProvidersOutput,
  FindBuyersInput,
} from "./types";

import type {
  BuyerCandidate,
  DiscoveryArgs,
  ScoredCandidate,
  ScoreOptions,
  RunProvidersOutput,
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
export const seeds     = pick(SeedsMod,  ["seeds", "getSeeds", "provider", "seedsProvider"]);
export const websearch = pick(SearchMod, ["websearch", "search", "provider", "searchWeb"]);
export const scorer    = pick(ScorerMod, ["scorer", "score", "provider", "scoreCandidates"]);

/* Public registry (kept for compatibility) */
export const providers = { seeds, websearch, scorer };

/* Helpers */
const isoNow = () => new Date().toISOString();

/**
 * Primary pipeline used by services. Returns an envelope:
 * { candidates: ScoredCandidate[], meta: { started, finished, ... } }
 */
export async function runProviders(ctx: DiscoveryArgs = {}): Promise<RunProvidersOutput> {
  const started = isoNow();
  const limit   = ctx?.limitPerSeed ?? 5;

  // ---- 1) seeds -------------------------------------------------------------
  let seedItems: BuyerCandidate[] = [];
  if (isFn(seeds)) {
    const out = await seeds(undefined, ctx);
    if (Array.isArray(out?.seeds)) seedItems = out.seeds as BuyerCandidate[];
    else if (Array.isArray(out))    seedItems = out as BuyerCandidate[];
  }

  // ---- 2) websearch -> candidates ------------------------------------------
  const rawCandidates: any[] = [];
  if (isFn(websearch) && seedItems.length) {
    for (const s of seedItems) {
      const q = (s as any)?.query ?? (s as any)?.host ?? s; // tolerate either seed shape
      const results = await websearch({ query: q, limit }, ctx);
      if (Array.isArray(results)) {
        for (const r of results) {
          rawCandidates.push({
            host:  (r as any).host ?? (r as any).domain ?? null,
            url:   (r as any).url  ?? (r as any).link   ?? (r as any).href ?? null,
            title: (r as any).title ?? (s as any).title ?? null,
            tags:  (s as any).tags ?? [],
            extra: { snippet: (r as any).snippet ?? (r as any).summary ?? null, source: "websearch" },
          });
        }
      }
    }
  }

  // ---- 3) score (optional) --------------------------------------------------
  let candidates: ScoredCandidate[] = rawCandidates as unknown as ScoredCandidate[];
  if (isFn(scorer)) {
    const scored = await scorer(rawCandidates, (ctx?.scoreOptions ?? {}) as ScoreOptions, ctx);
    if (Array.isArray(scored)) candidates = scored as ScoredCandidate[];
  }

  const finished = isoNow();
  return {
    candidates,
    meta: {
      started,
      finished,
      seedCount: seedItems.length,
      searchCount: rawCandidates.length,
    },
  };
}

/* Back-compat alias used by some modules/tests */
export const generateAndScoreCandidates = runProviders;

/* Default export */
export default providers;