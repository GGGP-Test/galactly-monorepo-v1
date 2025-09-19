/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Providers barrel + tiny pipeline.
 * Safe with either default or named exports in ./seeds, ./websearch, ./scorer.
 */

export type {
  Candidate,
  BuyerCandidate,
  DiscoveryArgs,
  ScoreOptions,
  ScoredCandidate,
  WebSearchQuery,
  WebSearchResult,
  Seed,
  SeedBatch,
  SeedsOutput,
  RunProvidersOutput,
  RunProvidersMeta,
} from "./types";

import type {
  DiscoveryArgs,
  ScoredCandidate,
  ScoreOptions,
  WebSearchResult,
  RunProvidersOutput,
  RunProvidersMeta,
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
 * Main pipeline used by services:
 * - seeds()   -> list of {host|query|title}
 * - websearch -> list of WebSearchResult
 * - scorer    -> ScoredCandidate[]
 * Returns { candidates, meta } for the service layer.
 */
export async function runProviders(
  args: Partial<DiscoveryArgs> = {}
): Promise<RunProvidersOutput> {
  const t0 = Date.now();
  const limitPerSeed = args.limitPerSeed ?? 5;
  const meta: RunProvidersMeta = { seeds: 0, searched: 0, scored: 0, notes: [] };

  // 1) SEEDS
  type SeedItem = { host?: string; query?: string; title?: string; tags?: string[] };
  let seedItems: SeedItem[] = [];
  if (isFn(seeds)) {
    const out = await seeds(undefined, args);
    const maybeSeeds: SeedItem[] =
      Array.isArray(out?.seeds) ? out.seeds : Array.isArray(out) ? out : [];
    seedItems = maybeSeeds;
    meta.seeds = seedItems.length;
  }

  // 2) WEBSEARCH
  const webDocs: WebSearchResult[] = [];
  if (isFn(websearch) && seedItems.length) {
    for (const s of seedItems) {
      const q = s.query ?? s.host ?? s.title ?? "";
      if (!q) continue;
      const results: WebSearchResult[] = await websearch(
        { query: q, limit: limitPerSeed, region: args.region, radiusMi: args.radiusMi ?? args.radiusMiles },
        args
      );
      if (Array.isArray(results)) webDocs.push(...results);
    }
  }
  meta.searched = webDocs.length;

  // 3) SCORE
  let candidates: ScoredCandidate[] = [];
  // We pass through extra fields (platform/temp/why/created) after scoring.
  const baseForScoring = webDocs.map((d) => ({
    host: d.host,
    url: d.url,
    title: d.title,
    tags: sTags(d.title),
    extra: { snippet: d.snippet },
  }));

  if (isFn(scorer) && baseForScoring.length) {
    const opts: ScoreOptions | undefined = args.scoreOptions ?? undefined;
    const scored: ScoredCandidate[] = await scorer(baseForScoring, opts, args);
    candidates = scored.map((c, i) => ({
      ...c,
      platform: webDocs[i]?.platform ?? "web",
      temp: webDocs[i]?.temp ?? c.label, // a decent default
      why: webDocs[i]?.why,
      created: webDocs[i]?.created,
    }));
  }

  meta.scored = candidates.length;
  meta.tookMs = Date.now() - t0;

  return { candidates, meta };
}

/* Helper: tiny tagger */
function sTags(title?: string): string[] {
  const s = (title ?? "").toLowerCase();
  const out: string[] = [];
  if (/\bbox\b|\bboxes\b|carton|pallet|tape|label|mailer/.test(s)) out.push("packaging");
  return out;
}

/* Backwards-compat alias some code may import */
export const generateAndScoreCandidates = async (ctx?: Partial<DiscoveryArgs>) => {
  const { candidates } = await runProviders(ctx ?? {});
  return candidates;
};

/* Default export */
export default providers;