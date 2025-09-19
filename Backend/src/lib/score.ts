import type { Persona } from "./types";
import { tokenize } from "./util";

export function scoreWithPersona(hayTokens: string[], persona?: Persona) {
  const offerT = tokenize(persona?.offer || "");
  const solvesT = tokenize(persona?.solves || "");
  const titlesT = tokenize(persona?.titles || "");
  const want = new Set([...offerT, ...solvesT, ...titlesT]);
  const hay = new Set(hayTokens.map((x) => x.toLowerCase()));

  let hits = 0;
  for (const w of want) if (hay.has(w)) hits++;

  // light boost for explicit title matches
  let titleHits = 0;
  for (const t of titlesT) if (hay.has(t)) titleHits++;

  const denom = Math.max(1, want.size);
  const raw = hits / denom;
  const boost = Math.min(0.3, titleHits * 0.1);
  const score = Math.max(0, Math.min(1, raw + boost));

  const why: string[] = [];
  if (titleHits > 0) why.push(`matched titles: ${titleHits}`);
  if (hits - titleHits > 0) why.push(`matched tags: ${hits - titleHits}`);
  if (why.length === 0) why.push("baseline relevance");

  return { score, why: why.join(", ") };
}