/**
 * Minimal, import-free type surface used by provider modules + services.
 * Safe to evolve and intentionally generous so other files compile.
 */

export type JSONObject = Record<string, unknown>;

/* Temperature labels used in UI & search heuristics */
export type Temp = "cold" | "warm" | "hot";

/** Generic candidate produced by search or scraping. */
export type Candidate = {
  host: string;                // e.g., "blueboxretail.com"
  url?: string;
  title?: string;
  tags?: string[];
  signals?: string[];
  distanceMiles?: number;
  extra?: JSONObject;
};

/** What the UI and services work with after scoring. */
export type ScoreLabel = "cold" | "warm" | "hot";

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;
  reasons: string[];

  /* extra, optional fields some services/UI read */
  platform?: "web" | "news" | "social" | string;
  temp?: Temp;                 // for websearch results passed through
  why?: string;
  created?: string;
};

/** Settings for the scoring pass */
export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;       // default 70
  warmThreshold?: number;      // default 40
};

/** Web search inputs/outputs (provider-agnostic). */
export type SearchRequest = {
  query: string;
  limit?: number;              // default 20
  region?: string;             // e.g., "US/CA"
  lang?: string;               // e.g., "en"
  radiusMi?: number;           // optional proximity hint
  radiusMiles?: number;        // alias used by some callers
};

export type SearchResult = {
  url?: string;
  host: string;
  title?: string;
  snippet?: string;

  /* same extras UI sometimes expects */
  platform?: "web" | "news" | "social" | string;
  temp?: Temp;
  why?: string;
  created?: string;
};

/* Friendly aliases used around the codebase */
export type WebSearchQuery  = SearchRequest;
export type WebSearchResult = SearchResult;

/** Seeds */
export type Seed = { query?: string; host?: string; title?: string; tags?: string[] };
export type SeedBatch = { name?: string; seeds: Seed[] };
export type SeedsOutput = { seeds: Seed[] };

/** Provider context & generic signature */
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
export type SeedProvider = Provider<void | { region?: string }, SeedBatch>;

/** What the "find buyers" service calls this with */
export type DiscoveryArgs = {
  region?: string;             // default "US/CA"
  radiusMi?: number;
  radiusMiles?: number;        // alias
  supplier?: string;           // supplier domain or human string
  persona?: string | string[]; // titles filter
  limitPerSeed?: number;       // default 5
  scoreOptions?: ScoreOptions;
};

export type FindBuyersInput = {
  supplierDomain: string;
  region?: string;
  persona?: string | string[];
  radiusMi?: number;
  radiusMiles?: number;
  limit?: number;
};

/** What runProviders returns to services */
export type RunProvidersMeta = {
  seeds?: number;
  searched?: number;
  scored?: number;
  tookMs?: number;
  notes?: string[];
};

export type RunProvidersOutput = {
  candidates: ScoredCandidate[];
  meta?: RunProvidersMeta;
};

/* Optional “compat” aliases some older modules import */
export type BuyerCandidate = ScoredCandidate;
export type LeadCandidate = ScoredCandidate;
export type Lead = ScoredCandidate;

/* Optional default export so `import types from "./types"` never breaks */
const types = {};
export default types;