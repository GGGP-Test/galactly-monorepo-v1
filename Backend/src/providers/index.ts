/**
 * Path: Backend/src/providers/index.ts
 * Aggregates provider modules with safe dynamic loading.
 * Works with the files in this folder:
 *   - types.ts
 *   - seeds.ts
 *   - websearch.ts
 *   - scorer.ts
 */

import type {
  ProviderContext,
  Candidate,
  ScoredCandidate,
  ScoreOptions,
  SearchRequest,
  SearchResult,
  SeedBatch,
  WebSearchProvider,
  SeedProvider,
} from "./types";

export type Providers = {
  seeds?: SeedProvider;
  websearch?: WebSearchProvider;
  scorer?: (
    candidates: Candidate[],
    options?: ScoreOptions,
    ctx?: ProviderContext
  ) => Promise<ScoredCandidate[]>;
};

let cached: Providers | null = null;

const isFn = (v: unknown): v is (...a: any[]) => any => typeof v === "function";

async function tryImport(path: string): Promise<any | null> {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

function pickSeedProvider(mod: any): SeedProvider | undefined {
  if (!mod) return undefined;
  const cand = mod.default ?? mod.seeds ?? mod.getSeeds ?? mod.provider;
  return isFn(cand) ? (cand as SeedProvider) : undefined;
}

function pickWebSearchProvider(mod: any): WebSearchProvider | undefined {
  if (!mod) return undefined;
  const cand = mod.default ?? mod.websearch ?? mod.search ?? mod.provider;
  return isFn(cand) ? (cand as WebSearchProvider) : undefined;
}

type ScorerFn = (
  candidates: Candidate[],
  options?: ScoreOptions,
  ctx?: ProviderContext
) => Promise<ScoredCandidate[]>;

function pickScorer(mod: any): ScorerFn | undefined {
  if (!mod) return undefined;
  const cand = mod.default ?? mod.scorer ?? mod.score ?? mod.provider;
  return isFn(cand) ? (cand as ScorerFn) : undefined;
}

/** Load and cache providers in this folder. */
export async function loadProviders(): Promise<Providers> {
  if (cached) return cached;

  const [seedsMod, searchMod, scorerMod] = await Promise.all([
    tryImport("./seeds"),
    tryImport("./websearch"),
    tryImport("./scorer"),
  ]);

  cached = {
    seeds: pickSeedProvider(seedsMod),
    websearch: pickWebSearchProvider(searchMod),
    scorer: pickScorer(scorerMod),
  };

  return cached;
}

/** Manually inject/override providers (useful for tests). */
export function setProviders(p: Providers) {
  cached = p;
}

/** Get currently loaded providers (loads on first call). */
export async function getProviders(): Promise<Providers> {
  return loadProviders();
}

/**
 * Orchestrator used by the button flow:
 * 1) seeds -> 2) websearch -> 3) scorer
 * Returns an array of ScoredCandidate.
 */
export async function generateAndScoreCandidates(
  ctx: ProviderContext & { limitPerSeed?: number } = {}
): Promise<ScoredCandidate[]> {
  const providers = await loadProviders();

  const seedProv = providers.seeds;
  const searchProv = providers.websearch;
  const scoreProv = providers.scorer;

  const batch: SeedBatch | undefined = seedProv ? await seedProv(undefined, ctx) : undefined;
  const seeds = batch?.seeds ?? [];
  const limitPerSeed = ctx?.limitPerSeed ?? 5;

  const candidates: Candidate[] = [];
  if (searchProv && seeds.length) {
    for (const s of seeds) {
      const results = await searchProv(
        { query: s.query, limit: limitPerSeed } as SearchRequest,
        ctx
      );
      for (const r of results as SearchResult[]) {
        candidates.push({
          host: r.host,
          url: r.url,
          title: r.title,
          tags: s.tags,
          extra: { snippet: r.snippet, source: "websearch" },
        });
      }
    }
  }

  if (!scoreProv) return [];
  return scoreProv(candidates, undefined, ctx);
}

/** Re-export types so external imports can do `from "./providers"` only. */
export * from "./types";

/** Default export for convenience. */
export default {
  loadProviders,
  getProviders,
  setProviders,
  generateAndScoreCandidates,
};