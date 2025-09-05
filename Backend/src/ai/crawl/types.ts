// src/ai/crawl/types.ts

/**
 * Shared crawl + discovery types used across scheduler/worker/enrichment.
 * Keep this file dependency-light so it can be imported broadly.
 */

import type { Region } from "../compliance/compliance"; // reuse Region from compliance module

// ---------------- Plans & Flags ----------------
export type Plan = "free" | "pro";

export interface PlanCaps {
  maxParallelSearches: number;
  maxSeedUrls: number;
  maxCrawlBytes: number;
  enablePII: boolean;
  enablePaidProviders: boolean;
}

// ---------------- Discovery (Search) ----------------
export interface SearchQuery {
  q: string;
  region?: Region;
  site?: string;          // constrain to host
  lang?: string;          // future
  recencyDays?: number;   // future
  tags?: string[];        // custom routing hints (e.g., "rfq", "reviews")
}

export interface SearchResult {
  url: string;
  title?: string;
  snippet?: string;
  score?: number;       // provider-specific relevance (0..1)
  source?: string;      // provider id
  tags?: string[];
}

export interface ISearchProvider {
  id: string;
  label: string;
  freeTier: boolean;
  // soft limit hint; the scheduler will meter calls if provided
  maxPerMinute?: number;
  search(query: SearchQuery): Promise<SearchResult[]>;
}

// ---------------- Crawl ----------------
export interface CrawlTask {
  url: string;
  plan: Plan;
  tags?: string[];
  robotsAllowed?: boolean;
  termsAllow?: boolean;
  referrer?: string;
  subjectRegion?: Region;
  priority?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface ExtractedSignals {
  title?: string;
  description?: string;
  emails?: string[];
  phones?: string[];
  hasCart?: boolean;
  ecommerceHint?: string;
  packagingKeywords: string[];
  rfqPhrases: string[];
  reviewHints: string[];
  platformHints: string[];
  analyticsHints: string[];
  careersLinks: string[];
  suppliersMentions: string[];
  blogRecentness?: { yyyy?: number; mm?: number };
  demand?: number;       // 0..1
  procurement?: number;  // 0..1
  ops?: number;          // 0..1
  reputation?: number;   // 0..1
  urgency?: number;      // 0..1
}

export interface LeadCandidate {
  company?: string;
  website: string;
  region?: Region;
  signals: ExtractedSignals;
  tagset?: string[];
}

export interface CrawlResult {
  url: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  http?: { status: number; bytes: number; contentType?: string };
  lead?: LeadCandidate;
  rawSnippet?: string;
  startedAt: number;
  finishedAt: number;
  plan: Plan;
}

// ---------------- Seeding ----------------
export type SeedSource =
  | "user-website"
  | "user-keywords"
  | "map-local"
  | "directories"
  | "social"
  | "ads"
  | "imports";

export interface LeadSeed {
  source: SeedSource;
  url: string;
  score?: number;     // seed confidence 0..1
  tags?: string[];
  region?: Region;
}

// ---------------- Playbooks / Weights (UI knobs) ----------------
export interface ScoringWeights {
  demand: number;
  procurement: number;
  ops: number;
  reputation: number;
  urgency: number;
}

export interface PlaybookPreset {
  id: "fast-close" | "lifetime" | "goodwill" | "balanced" | "custom";
  label: string;
  weights: ScoringWeights;
}

// ---------------- User input for discovery ----------------
export interface UserDiscoveryInput {
  website?: string;               // supplier site (our user's site)
  geo?: Region[];                 // where they want buyers (or ANY)
  focuses?: string[];             // product focus (e.g., "stretch wrap", "custom boxes")
  bannedCompetitors?: string[];   // suppliers to avoid (as matches)
  minCompanySize?: number;        // employees lower bound for buyers (optional)
  maxCompanySize?: number;        // employees upper bound for buyers (optional)
  avoidMegaSuppliers?: boolean;   // default true
  extraKeywords?: string[];       // user-provided long-tail
  preferredChannels?: string[];   // "Shopify", "Etsy", "Amazon", "B2B portal"
  playbook?: PlaybookPreset;      // chosen preset
}

// ---------------- Utility ----------------
export type Millis = number;

export const DEFAULT_PLAN_CAPS: Record<Plan, PlanCaps> = {
  free: {
    maxParallelSearches: 2,
    maxSeedUrls: 50,
    maxCrawlBytes: 750_000,
    enablePII: false,
    enablePaidProviders: false,
  },
  pro: {
    maxParallelSearches: 6,
    maxSeedUrls: 500,
    maxCrawlBytes: 2_000_000,
    enablePII: true,
    enablePaidProviders: true,
  },
};
