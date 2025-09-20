/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Providers registry + pipeline with a stable public API the rest of the app uses.
 * It accepts either default or named exports from ./seeds, ./websearch, ./scorer.
 */

export type {
  Candidate,
  BuyerCandidate,
  DiscoveryArgs,
  FindBuyersInput,
  ScoreOptions,
  ScoredCandidate,
  SearchRequest,
  SearchResult,
  Seed,
  SeedBatch,
  RunProvidersOutput,
  RunProvidersMeta,
} from "./types";

import type {
  Candidate,
  BuyerCandidate,
  FindBuyersInput,
  RunProvidersOutput,
  RunProvidersMeta,
  ScoreOptions,
  ScoredCandidate,
  SearchRequest,
  SearchResult,
} from "./types";

import * as SeedsMod from "./seeds";
import * as SearchMod from "./websearch";
import * as ScorerMod from "./scorer";

type ProviderFn = (...args: any[]) => any | Promise<any>;

const isFn = (v: any): v is ProviderFn => typeof v === "function";

/** find a callable in a module (default or one of the common names) */
function pick(mod: any, names: string[]): ProviderFn | undefined {
  if (!mod) return undefined;
  for (const n of ["default", ...names]) {
    const v = (mod as any)[n];
    if (typeof v === "function") return v;
  }
  if (typeof mod === "function") return mod;
  return undefined;
}

/* Accept multiple common names so we don't churn other files. */
const seedsFn  = pick(SeedsMod,  ["seeds", "getSeeds", "provider", "seedsProvider"]);
const searchFn = pick(SearchMod, ["websearch", "search", "searchWeb", "provider"]);
const scoreFn  = pick(ScorerMod, ["scoreCandidates", "scorer", "score", "provider"]);

/** Public registry (debugging convenience). */
export const providers = { seeds: seedsFn, websearch: searchFn, scorer: scoreFn };

/**
 * Main pipeline used by routes. It returns { candidates, meta } — NOT an array —
 * so it matches your `src/services/find-buyers.ts` usage.
 */
export async function runProviders(input: FindBuyersInput): Promise<RunProvidersOutput> {
  const t0 = Date.now();
  const limitPerSeed = input?.limitPerSeed ?? 5;

  // 1) Seeds (optional)
  let seeds: BuyerCandidate[] = [];
  if (isFn(seedsFn)) {
    try {
      const out = await seedsFn(input);
      if (Array.isArray(out)) seeds = out;
      else if (Array.isArray(out?.seeds)) seeds = out.seeds;
    } catch (err) {
      // ignore seeds errors; continue pipeline
    }
  }
  // Fallback seed if none
  if (seeds.length === 0 && input?.supplier) {
    seeds = [
      {
        host: input.supplier,
        platform: "news",
        title: "Buyer",
        source: "seeds",
        createdAt: new Date().toISOString(),
        proof: "seed",
      },
    ];
  }

  // 2) Web search (optional)
  let rawCandidates: Candidate[] = [];
  if (isFn(searchFn)) {
    for (const s of seeds) {
      const q: SearchRequest = {
        query: s.host,
        limit: limitPerSeed,
        region: input?.region,
      };
      try {
        const results: SearchResult[] = await searchFn(q, input);
        if (Array.isArray(results)) {
          for (const r of results) {
            rawCandidates.push({
              host: r.host ?? s.host,
              url: r.url,
              title: r.title ?? s.title,
              tags: s.tags ?? [],
              extra: { snippet: r.snippet ?? "", source: "websearch" },
              platform: "web",
              source: "websearch",
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch {
        /* ignore this seed’s search errors */
      }
    }
  } else {
    // If no websearch provider, use seeds as raw candidates.
    rawCandidates = seeds;
  }

  // 3) Score (optional; if missing, coerce into ScoredCandidate)
  let scored: ScoredCandidate[] = [];
  if (isFn(scoreFn)) {
    const scoreOpts: ScoreOptions = input?.scoreOptions ?? { supplierDomain: input?.supplier };
    scored = await scoreFn(rawCandidates, scoreOpts, input);
  } else {
    // Default naive scoring so the UI still shows temp/label.
    scored = rawCandidates.map((c) => ({
      ...c,
      score: 50,
      label: "warm",
      temp: "warm",
      reasons: ["default scorer"],
    }));
  }

  // Mirror label -> temp to satisfy UI that reads c.temp
  for (const c of scored) {
    c.temp = c.label;
  }

  const meta: RunProvidersMeta = {
    ms: Date.now() - t0,
    seeds: seeds.length,
    searched: rawCandidates.length,
    scored: scored.length,
  };

  return { candidates: scored, meta };
}

/* Back-compat aliases some code paths might import */
export const generateAndScoreCandidates = runProviders;
export default providers;