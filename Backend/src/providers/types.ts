// Path: Backend/src/providers/types.ts

/**
 * Minimal, import-free type surface used by provider + service modules.
 * Exports names expected across the repo (DiscoveryArgs, BuyerCandidate, etc.)
 * while keeping modern aliases (SearchRequest, SearchResult, …).
 */

export type JSONObject = Record<string, unknown>;

/* -------------------- Core candidate shapes -------------------- */

export type Temp = "cold" | "warm" | "hot";

/** Generic candidate produced by search/scraping/scoring. */
export type Candidate = {
  host: string;                // canonical host, e.g. "blueboxretail.com"
  title: string;               // make required to avoid strict-null errors in shared.ts
  url?: string;                // source URL for the signal
  tags?: string[];             // ["packaging","retail"]
  signals?: string[];          // ["rfq","quote"]
  distanceMiles?: number;      // proximity from user/supplier
  platform?: string;           // "web" | "news" | "seeds" | etc.
  created?: string;            // ISO timestamp
  extra?: JSONObject;          // any additional scraped fields
  /** Some routes/UI expect these even before scoring */
  temp?: Exclude<Temp, "cold">; // "warm" | "hot"
  why?: string;                // human-readable reason
};

export type ScoreLabel = Temp; // keep label compatible with UI

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;           // "cold" | "warm" | "hot"
  reasons: string[];           // rationale list
  /** mirror single-string fields many UIs expect */
  temp?: Exclude<Temp, "cold">;
  why?: string;
};

/* -------------------- Options / context -------------------- */

export type ScoreOptions = {
  supplierDomain?: string;
  hotThreshold?: number;       // default 70
  warmThreshold?: number;      // default 40
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

/* -------------------- Seeds -------------------- */

export type Seed = { query: string; tags?: string[] };
export type SeedBatch = { name?: string; seeds: Seed[]; meta?: JSONObject };
export type SeedsOutput = SeedBatch;

/* -------------------- Search -------------------- */

/** Arguments several routes build from the UI form. */
export type DiscoveryArgs = {
  region?: string;             // e.g., "US" | "US/CA"
  radiusMi?: number;           // UI uses 'radiusMi'
  radiusMiles?: number;        // some modules use 'radiusMiles'
  supplier?: string;           // supplier domain (e.g., "peekpackaging.com")
  persona?: string | string[]; // buyer role hints
  titles?: string[];           // explicit titles to look for
  limit?: number;              // cap results
  lang?: string;               // "en", etc.
  temp?: Exclude<Temp, "cold">;
};

export type WebSearchQuery = {
  query: string;
  limit?: number;
  region?: string;
  lang?: string;
  radiusMiles?: number;
  supplierDomain?: string;
} & Partial<DiscoveryArgs>;

export type WebSearchResult = {
  host: string;                // domain of the hit
  title: string;               // role/title inferred
  platform: "web" | "news";
  temp: Exclude<Temp, "cold">; // warm | hot
  why: string;                 // human-readable reason
  created: string;             // ISO timestamp
  url?: string;                // optional landing URL
  snippet?: string;            // optional summary
};

/* -------------------- Provider call signatures -------------------- */

export interface Provider<TIn, TOut> {
  (input: TIn, ctx?: ProviderContext): Promise<TOut>;
}

export type WebSearchProvider = Provider<WebSearchQuery, WebSearchResult[]>;
export type SeedProvider = Provider<void | { region?: string }, SeedsOutput>;

/* -------------------- Friendly aliases (back-compat) -------------------- */

// Old / generic names that some modules might import.
export type SearchRequest = WebSearchQuery;
export type SearchResult = {
  url?: string;
  host: string;
  title?: string;
  snippet?: string;
};
export type LeadCandidate = Candidate;
export type Lead = ScoredCandidate;
export type BuyerCandidate = Candidate;

/* Optional default export to avoid breaking `import types from "./types"` */
const types = {};
export default types;