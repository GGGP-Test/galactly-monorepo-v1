// Backend/src/providers/index.ts

import type { Candidate, FindBuyersInput } from "./types";
import { websearchProvider } from "./websearch";
import { seedCandidates } from "./seeds";
import { dedupeByHost, normalizeHost } from "./shared";
import { scoreCandidates } from "./scorer";

export async function runProviders(input: FindBuyersInput): Promise<{
  candidates: Candidate[];
  meta: { providerCounts: Record<string, number>; supplierHost: string; region: string };
}> {
  const results: { name: string; candidates: Candidate[] }[] = [];

  // 1) Try key-less discovery (may return 0 if egress is blocked)
  try {
    const web = await websearchProvider(input);
    results.push({ name: web.name, candidates: web.candidates });
  } catch {
    results.push({ name: "websearch", candidates: [] });
  }

  // 2) Merge & dedupe
  let merged = dedupeByHost(results.flatMap(r => r.candidates));

  // 3) Backfill so Free Panel never shows empty
  const MIN_TARGET = 12;
  if (merged.length < MIN_TARGET) {
    const seeds = seedCandidates(input);
    const need = MIN_TARGET - merged.length;
    merged = dedupeByHost([...merged, ...seeds.slice(0, Math.max(0, need))]);
  }

  // 4) Hot/Warm scoring (deterministic + persona-aware)
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
