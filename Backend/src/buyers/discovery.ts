// Backend/src/buyers/discovery.ts
// A minimal, router-compatible discovery module.
// It deliberately avoids returning generic/current customers.
// Returns 200 with an empty candidate list until warm/hot collectors are plugged in.

type Region = "us" | "ca" | "usca";

export interface FindBuyersInput {
  supplier: string;              // supplier domain e.g. peekpackaging.com
  region?: Region;               // us | ca | usca (default usca)
  radiusMi?: number;             // default 50
  persona?: {
    offer?: string;
    solves?: string;
    titles?: string;             // comma-separated titles, optional
  };
  onlyUSCA?: boolean;            // if true, clamp to us/ca only
}

export interface WhyPart {
  label?: string;
  score?: number;
  detail?: string;
}

export interface Why {
  meta?: WhyPart;
  platform?: WhyPart;
  signal?: WhyPart;
  context?: WhyPart;
}

export interface Candidate {
  host: string;
  company?: string;
  title?: string;
  platform?: string;
  temperature?: "warm" | "hot";
  whyText?: string;
  why?: Why;
  created?: string;
}

export interface FindBuyersResult {
  ok: boolean;
  created: number;
  candidates: Candidate[];
}

/**
 * Persist candidates if a store is available (no-op if not).
 * We try a few likely function names but never throw if missing.
 */
async function persistCandidates(cands: Candidate[]): Promise<void> {
  try {
    const store = await import("../buyers/store"); // prefer scoped store
    const save =
      (store as any).insertMany ||
      (store as any).saveCandidates ||
      (store as any).create ||
      (store as any).default;
    if (typeof save === "function") {
      await save(cands);
    }
  } catch {
    // Silently ignore: store is optional in Free plan
  }
}

/**
 * Core: find buyers (placeholder).
 * Policy: NO generic buyers & NO current customers.
 * Until signal collectors are connected, we return an empty set (200 OK).
 */
export async function findBuyers(input: FindBuyersInput): Promise<FindBuyersResult> {
  // Normalize input
  const supplier = String(input?.supplier || "").trim().toLowerCase();
  if (!supplier) {
    return { ok: false, created: 0, candidates: [] };
  }

  const region: Region = (input?.region as Region) || "usca";
  const radiusMi = Number(input?.radiusMi || 50) || 50;
  const persona = {
    offer:  (input?.persona?.offer  || "").trim(),
    solves: (input?.persona?.solves || "").trim(),
    titles: (input?.persona?.titles || "").trim(),
  };
  const onlyUSCA = Boolean(
    input?.onlyUSCA ?? (region === "us" || region === "ca" || region === "usca")
  );

  // Placeholder: we purposely DO NOT produce generic candidates.
  // As soon as we connect the warm/hot collectors, results will appear here.
  const candidates: Candidate[] = [];

  // Optional: persist (no-op if store not present)
  await persistCandidates(candidates);

  return { ok: true, created: candidates.length, candidates };
}

// Provide multiple export names so any router convention can call us.
export const discover = findBuyers;
export const run = findBuyers;
export default findBuyers;
