import type { Candidate, Persona } from "../types";
import { fromSeeds } from "./seed";

// later you can add real providers and merge them here.
export async function discoverCandidates(opts: {
  supplier?: string;
  region?: string;
  radiusMi?: number;
  persona?: Persona;
}): Promise<{ created: number; candidates: Candidate[]; note?: string }> {
  const mode = (process.env.DISCOVERY || "seed").toLowerCase();

  // always include seeds so Free Panel has something useful
  const seeds = fromSeeds({ region: opts.region, persona: opts.persona });

  if (mode === "seed") {
    return { created: 0, candidates: seeds, note: "seed-based matches (demo data)" };
  }

  // placeholder for future providers; for now behave like seed
  return { created: 0, candidates: seeds, note: "discovery disabled -> seed fallback" };
}