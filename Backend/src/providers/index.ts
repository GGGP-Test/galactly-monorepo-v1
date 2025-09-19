// Backend/src/providers/index.ts

import { websearchProvider } from "./websearch";
import { scoreCandidates } from "./scorer";

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

  // 1) Key-less web discovery
  const web = await websearchProvider(input);
  results.push(web);

  // 2) Merge & dedupe
  const merged = dedupeByHost(results.flatMap(r => r.candidates));

  // 3) Score -> hot/warm
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