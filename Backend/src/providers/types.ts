/**
 * Path: Backend/src/providers/types.ts
 * Minimal, import-free type surface used by provider modules.
 * Designed to compile even if other files are still stubs.
 */

export type JSONObject = Record<string, unknown>;

/** Generic candidate produced by search or scraping. */
export type Candidate = {
  host: string;                // required canonical host, e.g. "blueboxretail.com"
  url?: string;                // source URL for the signal
  title?: string;              // role/title if known (e.g., "Purchasing Manager")
  tags?: string[];             // normalized topical tags (e.g., ["packaging","retail"])
  signals?: string[];          // free-form hints (e.g., ["rfq","quote"])
  distanceMiles?: number;      // optional proximity from user/supplier
  extra?: JSONObject;          // any additional scraped fields
};

export type ScoreLabel = "cold" | "warm" | "hot";

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;
  reasons: string[];           // human-readable rationale
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
  region?: string;             // geo/market hint (e.g., "US")
  lang?: string;               // language hint (e.g., "en")
};

export type SearchResult = {
  url: string;
  host: string;
  title?: string;
  snippet?: string;
};

/** Common provider call signature. */
export type ProviderContext = {
  now?: Date;
  logger?: {
    debug: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
  fetch?: typeof globalThis.fetch | ((...a: unknown[]) => Promise<unknown>);
};

export interface Provider<TIn, TOut> {
  (input: TIn, ctx?: ProviderContext): Promise<TOut>;
}

export type WebSearchProvider = Provider<SearchRequest, SearchResult[]>;
export type Seed = { query: string; tags?: string[] };
export type SeedBatch = { name: string; seeds: Seed[] };
export type SeedProvider = Provider<void | { region?: string }, SeedBatch>;

/* ---------- Friendly aliases (helps other files compile) ---------- */
export type Query = SearchRequest;
export type WebDoc = SearchResult;
export type LeadCandidate = Candidate;
export type Lead = ScoredCandidate;

/* Optional default export so `import types from "./types"` doesn't break */
const types = {};
export default types;