// src/services/find-buyers.ts
// Keep this module self-contained: local types + stable cache imports.

import { makeKey, cacheGet, cacheSet } from "../utils/fsCache";

// Local, UI-facing shape (matches columns in the Free Panel)
type UICandidate = {
  host: string;
  platform: string;      // e.g., "news"
  title: string;         // e.g., "Buyer"
  created: string;       // ISO date
  temp: "hot" | "warm" | "cold";
  why: string[];         // human-readable reasons
};

// Minimal input needed by the route (avoid importing drifting provider types)
type FindBuyersInput = {
  persona: { domain: string };
  region?: string;       // "US/CA" etc.
  radiusMi?: number;     // 50 etc.
};

// Exported API the router calls
export async function findBuyers(input: FindBuyersInput): Promise<UICandidate[]> {
  // Guard: avoid "possibly undefined"
  if (!input || !input.persona || !input.persona.domain) return [];

  const key = makeKey({
    domain: input.persona.domain,
    region: input.region,
    radius: input.radiusMi,
  });

  const cached = cacheGet<UICandidate[]>(key);
  if (cached) return cached;

  // --- Discovery logic placeholder ---
  // (Your real discovery stays here; this just guarantees types/build.)
  const out: UICandidate[] = [];
  for (let i = 0; i < 20; i += 1) {
    out.push({
      host: `lead-${i}.${input.persona.domain}`,
      platform: "news",
      title: "Buyer",
      created: new Date().toISOString(),
      // IMPORTANT: one temperature field only (no duplicate hot/warm keys)
      temp: "warm",
      why: ["seed"],
    });
  }
  // -----------------------------------

  cacheSet(key, out);
  return out;
}

// Some code expects a default export
export default findBuyers;