/**
 * Single source of truth for provider-layer types.
 * Kept permissive so other files compile even while stubs evolve.
 */

export type JSONObject = Record<string, unknown>;
export type Temp = "cold" | "warm" | "hot";

/** Base fields any candidate may carry. */
export type CandidateBase = {
  host: string;                 // canonical host, e.g. "blueboxretail.com"
  url?: string;                 // source URL for the signal
  title?: string;               // role/title if known
  platform?: "web" | "news";    // where it came from
  tags?: string[];
  signals?: string[];
  distanceMiles?: number;
  createdAt?: string;           // ISO timestamp
  source?: string;              // 'seeds' | 'web' | ...
  proof?: string;               // short provenance hint
  extra?: JSONObject;
};

export type BuyerCandidate = CandidateBase & {
  temp?: Temp;                  // optional temperature
  why?: string;                 // human-readable rationale
};

export type Candidate = CandidateBase;      // backward-compat
export type LeadCandidate = BuyerCandidate; // friendly alias

export type ScoreLabel = Temp;

export type ScoredCandidate = BuyerCandidate & {
  score: number;                // 0..100
  label: ScoreLabel;
  reasons: string[];            // why the score was assigned
};

export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;        // default ~70
  warmThreshold?: number;       // default ~40
};

/** Web search provider I/O (provider-agnostic). */
export type SearchRequest = {
  query: string;
  limit?: number;
  region?: string;
  lang?: string;
};

export type SearchResult = {
  url: string;
  host: string;
  title?: string;
  snippet?: string;
};

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

/* -------- Seeds (light-weight inputs) -------- */
export type Seed = { query: string; tags?: string[] };
export type SeedBatch = { name: string; seeds: Seed[] };
export type SeedProvider = Provider<void | { region?: string }, SeedBatch>;

/* -------- Orchestration inputs/outputs -------- */
export type PersonaInput = {
  offer?: string;
  solves?: string;
  titles?: string | string[];
};

/** Generic args many providers accept; kept permissive. */
export type DiscoveryArgs = {
  supplier?: string;
  region?: string;
  radiusMi?: number;
  persona?: PersonaInput;
  limit?: number;
  limitPerSeed?: number;
  scoreOptions?: ScoreOptions;
};

/** API surface used by /api/v1/leads/find-buyers */
export type FindBuyersInput = {
  supplier: string;
  region: string;
  radiusMi: number;
  persona: PersonaInput;
};

export type RunProvidersMeta = {
  seeds?: number;
  searched?: number;
  scored?: number;
  hot?: number;
  warm?: number;
  ms?: number;
};

export type RunProvidersOutput = {
  candidates: BuyerCandidate[];
  meta?: RunProvidersMeta;
};

/* Optional default export so `import types from "./types"` doesn't break */
const types = {};
export default types;