import type { Candidate } from "./types";

export function dedupeKeepBest(cands: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of cands) {
    const key = `${c.host}::${(c.company || "").toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || c.score > prev.score) byKey.set(key, c);
  }
  return [...byKey.values()];
}