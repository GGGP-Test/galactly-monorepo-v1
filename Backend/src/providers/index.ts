// Path: Backend/src/providers/index.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Single, safe registry + pipeline.
 * Works whether ./seeds, ./websearch, ./scorer export default or named fns.
 * Touch NOTHING else.
 */

import * as SeedsMod from "./seeds";
import * as SearchMod from "./websearch";
import * as ScorerMod from "./scorer";

type ProviderFn = (...args: any[]) => any | Promise<any>;

const isFn = (v: any): v is ProviderFn => typeof v === "function";
const pick = (mod: any, names: string[]): ProviderFn | undefined => {
  if (!mod) return undefined;
  for (const n of ["default", ...names]) {
    const v = (mod as any)[n];
    if (isFn(v)) return v;
  }
  if (isFn(mod)) return mod;
  return undefined;
};

// Resolve provider functions (handles default or named exports)
export const seeds = pick(SeedsMod, ["seeds", "getSeeds", "provider"]);
export const websearch = pick(SearchMod, ["websearch", "search", "provider"]);
export const scorer = pick(ScorerMod, ["scorer", "score", "provider"]);

// Public registry
export const providers = { seeds, websearch, scorer };

// Minimal pipeline used by the app; safe if any step is missing.
export async function generateAndScoreCandidates(ctx: any = {}): Promise<any[]> {
  const limit = ctx?.limitPerSeed ?? 5;
  const nowISO = () => new Date().toISOString();

  // 1) Seeds
  let seedItems: any[] = [];
  if (isFn(seeds)) {
    const out = await seeds(ctx);
    if (Array.isArray(out?.seeds)) seedItems = out.seeds;
    else if (Array.isArray(out)) seedItems = out;
  }

  // 2) Web search
  const candidates: any[] = [];
  if (isFn(websearch) && seedItems.length) {
    for (const s of seedItems) {
      const q = (s && typeof s === "object" ? s.query : s) ?? s;
      const results = await websearch(
        { query: q, limit, region: ctx.region, radiusMiles: ctx.radiusMiles },
        ctx
      );
      if (Array.isArray(results)) {
        for (const r of results) {
          candidates.push({
            host: r.host ?? r.domain ?? null,
            url: r.url ?? r.link ?? r.href ?? null,
            title: r.title ?? r.pageTitle ?? null,
            platform: "web",
            tags: s?.tags ?? [],
            createdAt: nowISO(),
            extra: { snippet: r.snippet ?? r.summary ?? null, source: "websearch" },
          });
        }
      }
    }
  }

  // 3) Score (optional)
  if (isFn(scorer)) {
    const scored = await scorer(candidates, ctx?.scoreOptions ?? {});
    if (Array.isArray(scored)) return scored;
  }
  return candidates;
}

// Default export (kept for existing imports)
export default providers;