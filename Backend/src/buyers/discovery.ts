// Backend/src/buyers/discovery.ts
// Orchestrates buyer discovery by calling free/paid adapters.
// First adapter: news-based warm/hot signals (free, RSS).

import { collectNews } from "./adapters/news";

type Region = "us" | "ca" | "usca";

export interface FindBuyersInput {
  supplier: string;
  region?: Region;
  radiusMi?: number;
  persona?: { offer?: string; solves?: string; titles?: string };
  onlyUSCA?: boolean;
}

export interface Candidate {
  host: string;
  company?: string;
  title?: string;
  platform?: string;
  temperature?: "warm" | "hot";
  whyText?: string;
  why?: any;
  created?: string;
}

export interface FindBuyersResult {
  ok: boolean;
  created: number;
  candidates: Candidate[];
}

async function persistCandidates(cands: Candidate[]): Promise<void> {
  try {
    const store = await import("../buyers/store"); // optional
    const save =
      (store as any).insertMany ||
      (store as any).saveCandidates ||
      (store as any).create ||
      (store as any).default;
    if (typeof save === "function" && cands.length) {
      await save(cands);
    }
  } catch { /* optional */ }
}

export async function findBuyers(input: FindBuyersInput): Promise<FindBuyersResult> {
  const supplier = String(input?.supplier || "").trim().toLowerCase();
  if (!supplier) return { ok: false, created: 0, candidates: [] };

  const region: Region = (input?.region as Region) || "usca";
  const radiusMi = Number(input?.radiusMi || 50) || 50;
  const persona = {
    offer:  (input?.persona?.offer  || "").trim(),
    solves: (input?.persona?.solves || "").trim(),
    titles: (input?.persona?.titles || "").trim(),
  };

  // --- Adapters (free first) ---
  // 1) News-based signals (free RSS). Avoid supplier and generic sources inside the adapter.
  let candidates: Candidate[] = [];
  try {
    const news = await collectNews({ supplierDomain: supplier, region, radiusMi, persona });
    candidates = candidates.concat(news);
  } catch { /* if an adapter fails, continue */ }

  // TODO (paid / optional): add Places, LinkedIn Jobs, Ads, Commerce feeds, etc.

  // Deduplicate by host + title
  const key = (c: Candidate) => `${c.host}||${(c.title || "").toLowerCase()}`;
  const seen = new Set<string>();
  const deduped = candidates.filter(c => {
    const k = key(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  await persistCandidates(deduped);

  return { ok: true, created: deduped.length, candidates: deduped };
}

export const discover = findBuyers;
export const run = findBuyers;
export default findBuyers;
