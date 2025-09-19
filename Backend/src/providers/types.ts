/**
 * Minimal, import-free type surface for provider modules.
 * Adds compatibility aliases used across the codebase.
 */

export type JSONObject = Record<string, unknown>;

/** Generic candidate produced by search/scraping. */
export type Candidate = {
  host: string;                // e.g., "blueboxretail.com"
  url?: string;
  title?: string;              // e.g., "Purchasing Manager"
  tags?: string[];
  signals?: string[];
  distanceMiles?: number;
  extra?: JSONObject;
};

export type ScoreLabel = "cold" | "warm" | "hot";

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;
  reasons: string[];
};

export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;       // default 70
  warmThreshold?: number;      // default 40
};

/** Web search inputs/outputs (provider-agnostic). */
export type SearchRequest = {
  query: string;
  limit?: number;              // default 20
  region?: string;             // e.g., "US"
  lang?: string;               // e.g., "en"
};

export type SearchResult = {
  url: string;
  host: string;
  title?: string;
  snippet?: string;
};

/** Common provider ctx. */
export type ProviderContext = {
  now?: Date;
  logger?: {
    debug: (...a: unknown[]) => void;
    info:  (...a: unknown[]) => void;
    warn:  (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
  fetch?: typeof globalThis.fetch | ((...a: unknown[]) => Promise<unknown>);
};

export interface Provider<TIn, TOut> {
  (input: TIn, ctx?: ProviderContext): Promise<TOut>;
}

export type WebSearchProvider = Provider<SearchRequest, SearchResult[]>;

/** --------- Seeds & buyers compatibility types --------- */

/** What many seed funcs in this repo output. */
export type BuyerCandidate = {
  host: string;
  title?: string;
  platform?: "web" | "news" | string;
  source?: string;
  createdAt?: string;          // ISO string
  proof?: string;
  tags?: string[];
};

/** Some seed providers return an envelope, some return an array. Support both. */
export type SeedsOutput =
  | BuyerCandidate[]
  | { seeds: BuyerCandidate[]; meta?: JSONObject };

/** Inputs commonly passed around discovery/find-buyers flows. */
export type DiscoveryArgs = {
  region?: string;
  limitPerSeed?: number;
  radiusMiles?: number;
  supplierDomain?: string;
  scoreOptions?: ScoreOptions;
};

export type FindBuyersInput = DiscoveryArgs;

/** Names used by some modules; alias to generic search types. */
export type WebSearchQuery  = SearchRequest;
export type WebSearchResult = SearchResult;

/** Output shape expected by services/find-buyers.ts */
export type RunProvidersMeta = {
  started: string;             // ISO
  finished: string;            // ISO
  seedCount?: number;
  searchCount?: number;
};

export type RunProvidersOutput = {
  candidates: ScoredCandidate[];
  meta: RunProvidersMeta;
};

/** Friendly aliases */
export type Query       = SearchRequest;
export type WebDoc      = SearchResult;
export type Lead        = ScoredCandidate;
export type LeadCandidate = Candidate;

/** Optional default export to avoid breaking `import types from "./types"` */
const types = {};
export default types;