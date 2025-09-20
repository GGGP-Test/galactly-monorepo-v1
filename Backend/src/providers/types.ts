/**
 * Minimal public surface exported by ../providers so the rest of the app
 * (routes/services) compiles without caring how providers are implemented.
 */

export type JSONObject = Record<string, unknown>;

/** Raw candidate from search/scrape/seeds. */
export type Candidate = {
  host: string;          // e.g., "blueboxretail.com" (normalized)
  url?: string;          // source URL
  title?: string;        // role/title if known
  tags?: string[];
  signals?: string[];
  distanceMiles?: number;
  extra?: JSONObject;
  /** Keep temp for UI code that filters by hot/warm; mirrors label. */
  temp?: ScoreLabel;
  platform?: string;     // e.g., "web" | "news"
  source?: string;       // e.g., "websearch" | "seeds"
  createdAt?: string;    // ISO timestamp
  proof?: string;        // small provenance marker
};

export type ScoreLabel = "cold" | "warm" | "hot";

export type ScoredCandidate = Candidate & {
  score: number;         // 0..100
  label: ScoreLabel;     // we’ll also mirror to .temp for compatibility
  reasons: string[];
};

export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;   // default 70
  warmThreshold?: number;  // default 40
};

/** Web search inputs/outputs (provider-agnostic). */
export type SearchRequest = {
  query: string;
  limit?: number;          // default 20
  region?: string;
  lang?: string;
};

export type SearchResult = {
  url: string;
  host: string;
  title?: string;
  snippet?: string;
};

/** Persona the UI can pass (all optional). */
export type Persona = {
  offer?: string;
  solves?: string;
  titles?: string | string[];
};

/** The input your route passes to runProviders. */
export type FindBuyersInput = {
  supplier: string;        // supplier domain (peekpackaging.com)
  region?: string;         // e.g., "usca"
  radiusMi?: number;       // e.g., 50
  persona?: Persona;
  /** Optional knobs used by pipeline; safe to ignore by implementations. */
  limitPerSeed?: number;
  scoreOptions?: ScoreOptions;
};

/** Legacy alias used by some provider files. */
export type DiscoveryArgs = FindBuyersInput;

/** Seed shapes (used by optional seeds provider). */
export type Seed = { query: string; tags?: string[] };
export type SeedBatch = { name: string; seeds: Seed[] };

/** Friendly alias some older code uses. */
export type BuyerCandidate = Candidate;

/** Context each provider may optionally accept. */
export type ProviderContext = {
  now?: Date;
  fetch?: typeof globalThis.fetch | ((...a: unknown[]) => Promise<unknown>);
  logger?: {
    debug: (...a: unknown[]) => void;
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
  };
};

export interface Provider<TIn, TOut> {
  (input: TIn, ctx?: ProviderContext): Promise<TOut>;
}

export type WebSearchProvider = Provider<SearchRequest, SearchResult[]>;
export type SeedProvider = Provider<Partial<DiscoveryArgs> | void, BuyerCandidate[]>;

/** What runProviders returns (this is what your route expects). */
export type RunProvidersMeta = {
  ms: number;
  seeds?: number;
  searched?: number;
  scored?: number;
};

export type RunProvidersOutput = {
  candidates: ScoredCandidate[]; // (or unscored if scorer missing; kept as ScoredCandidate[] for DX)
  meta: RunProvidersMeta;
};

/* Optional default export so `import types from "./types"` doesn’t break */
const types = {};
export default types;