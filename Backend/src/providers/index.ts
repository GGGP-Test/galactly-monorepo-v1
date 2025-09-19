// Backend/src/providers/index.ts

import { websearchProvider } from "./websearch";
import { scoreCandidates } from "./scorer";
import { seedCandidates } from "./seeds";

export type Temp = "hot" | "warm";

export interface Candidate {
  host: string;
  platform?: string;   // "web" | "news" | etc
  title?: string;
  why?: string;
  temp?: Temp;
}

export interface FindBuyersInput {
  supplier: string; // supplier domain (e.g., peekpackaging.com)
  region: string;   // "usca", "us", "ca", etc.
  radiusMi: number;
  persona: {
    offer: string;
    solves: string;
    titles: string; // CSV of desired buyer titles
  };
}

export interface ProviderResult {
  name: string;
  candidates: Candidate[];
  debug?: Record<string, unknown>;
}

export function normalizeHost(s: string): string {
  try {
    const u = s.includes("://") ? new URL(s) : new URL("https://" + s);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return (s || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}

function dedupeByHost(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of list) {
    const key = (c.host || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function runProviders(input: FindBuyersInput): Promise<{
  candidates: Candidate[];
  meta: { providerCounts: Record<string, number>; supplierHost: string; region: string };
}> {
  const results: ProviderResult[] = [];

  // 1) key-less web/news discovery (may return 0 if egress blocked)
  const web = await websearchProvider(input);
  results.push(web);

  // 2) merge & dedupe
  let merged = dedupeByHost(results.flatMap(r => r.candidates));

  // 3) if discovery came back thin, backfill with curated seeds
  const MIN_TARGET = 12;
  if (merged.length < MIN_TARGET) {
    const seeds = seedCandidates(input);
    const need = MIN_TARGET - merged.length;
    merged = dedupeByHost([...merged, ...seeds.slice(0, Math.max(0, need))]);
  }

  // 4) hot/warm scoring
  const scored = await scoreCandidates(input, merged);

  return {
    candidates: scored,
    meta: {
      providerCounts: Object.fromEntries(results.map(r => [r.name, r.candidates.length])),
      supplierHost: normalizeHost(input.supplier),
      region: input.region
    }
  };
}