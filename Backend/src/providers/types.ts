/**
 * Minimal, import-free types used by provider modules and routes.
 * Safe to extend; try not to import app-level types here.
 */

export type JSONObject = Record<string, unknown>;

export type Candidate = {
  host: string;                // canonical host, e.g. "blueboxretail.com"
  url?: string;
  title?: string;              // role/title like "Purchasing Manager"
  tags?: string[];
  signals?: string[];
  distanceMiles?: number;
  extra?: JSONObject;
  // UI niceties many callers expect:
  platform?: string;           // e.g., "web" | "news"
  source?: string;             // e.g., "seed" | "websearch"
  created?: string;            // ISO timestamp
};

export type ScoreLabel = "cold" | "warm" | "hot";

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;
  /** Some UI code expects `temp`—mirror `label` for compatibility */
  temp?: ScoreLabel;
  reasons: string[];           // human-readable rationale
};

export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;       // default 70
  warmThreshold?: number;      // default 40
};

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

/** Persona + route input */
export type PersonaInput = {
  offer: string;
  solves: string;
  /** string or list of buyer titles */
  titles: string | string[];
};

export type FindBuyersInput = {
  supplier: string;
  region?: string;             // e.g., "usca"
  radiusMi?: number;           // optional
  persona?: PersonaInput;
  scoreOptions?: ScoreOptions;
  limitPerSeed?: number;       // cap per seed during search
};

export type RunProvidersMeta = {
  seeds: number;
  searched: number;
  scored: number;
  hot: number;
  warm: number;
  ms: number;
};

export type RunProvidersOutput = {
  candidates: ScoredCandidate[];
  meta: RunProvidersMeta;
};

/* Friendly aliases some older modules might use */
export type Lead = ScoredCandidate;
export type LeadCandidate = Candidate;

/* default export stays */
const types = {};
export default types;