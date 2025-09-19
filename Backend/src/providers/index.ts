import { websearchProvider } from "./websearch";

export type Temp = "hot" | "warm" | "cold";

export interface Candidate {
  host: string;
  platform?: string;   // e.g. "web", "news"
  title?: string;      // buyer title if inferred
  why?: string;        // short human-readable reason
  temp?: Temp;
}

export interface FindBuyersInput {
  supplier: string; // supplier domain (e.g., peekpackaging.com)
  region: string;   // "usca" etc.
  radiusMi: number; // numeric miles
  persona: {
    offer: string;
    solves: string;
    titles: string; // comma-separated desired buyer titles (optional)
  };
}

export interface ProviderResult {
  name: string;
  candidates: Candidate[];
  debug?: Record<string, unknown>;
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

  // 1st provider: key-less web search (HTML/RSS)
  results.push(await websearchProvider(input));

  // merge & dedupe
  const merged = dedupeByHost(results.flatMap(r => r.candidates));

  return {
    candidates: merged,
    meta: {
      providerCounts: Object.fromEntries(results.map(r => [r.name, r.candidates.length])),
      supplierHost: normalizeHost(input.supplier),
      region: input.region
    }
  };
}

export function normalizeHost(s: string): string {
  try {
    const u = s.includes("://") ? new URL(s) : new URL("https://" + s);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return (s || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}