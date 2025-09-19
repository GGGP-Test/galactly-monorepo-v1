// Backend/src/providers/scorer.ts

import type { Candidate, FindBuyersInput } from "./types";
import { csvToList } from "./shared";

export async function scoreCandidates(
  input: FindBuyersInput,
  list: Candidate[]
): Promise<Candidate[]> {
  const titleTerms = csvToList(input.persona?.titles || "purchasing,procurement,buyer,sourcing")
    .map(s => s.toLowerCase());
  const offerTerms = (input.persona?.offer || "").toLowerCase().split(/\W+/).filter(Boolean);
  const solveTerms = (input.persona?.solves || "").toLowerCase().split(/\W+/).filter(Boolean);

  return list.map(c => {
    const h = (c.host || "").toLowerCase();

    let score = 0;
    for (const t of titleTerms) if (h.includes(t.replace(/\s+/g, ""))) score += 2;
    for (const t of offerTerms) if (t && h.includes(t)) score += 1;
    for (const t of solveTerms) if (t && h.includes(t)) score += 1;
    if ((c.platform || "") === "news") score += 1;

    const temp = score >= 3 ? "hot" : "warm";
    return { ...c, temp };
  });
}