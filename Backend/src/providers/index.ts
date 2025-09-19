/* Path: Backend/src/providers/index.ts
   Purpose: Load providers (seeds, websearch, scorer) safely and orchestrate them.
   NOTE: This file is self-contained and avoids strict type coupling. */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Providers = {
  seeds?: (...args: any[]) => Promise<any>;
  websearch?: (...args: any[]) => Promise<any>;
  scorer?: (...args: any[]) => Promise<any>;
};

let _providers: Providers | null = null;

const isFn = (v: any): v is (...a: any[]) => any => typeof v === "function";

/** Try multiple import patterns + require() fallback so it works in CJS/ESM and with .ts/.js builds. */
async function tryImportAll(base: string): Promise<any | null> {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}/index`,
    `${base}/index.ts`,
    `${base}/index.js`,
  ];
  for (const p of candidates) {
    try {
      return await import(p);
    } catch {
      try {
        const req = (0, eval)("typeof require !== 'undefined' ? require : null") as
          | ((x: string) => any)
          | null;
        if (req) return req(p);
      } catch {
        /* ignore and try next */
      }
    }
  }
  return null;
}

function pick(mod: any, keys: string[]): any | undefined {
  if (!mod) return undefined;
  for (const k of ["default", ...keys]) {
    const v = mod[k];
    if (isFn(v)) return v;
  }
  return undefined;
}

/** Load (and cache) providers that live in this folder. */
export async function loadProviders(): Promise<Providers> {
  if (_providers) return _providers;

  const [seedsMod, searchMod, scorerMod] = await Promise.all([
    tryImportAll("./seeds"),
    tryImportAll("./websearch"),
    tryImportAll("./scorer"),
  ]);

  _providers = {
    seeds: pick(seedsMod, ["seeds", "getSeeds", "provider"]),
    websearch: pick(searchMod, ["websearch", "search", "provider"]),
    scorer: pick(scorerMod, ["scorer", "score", "provider"]),
  };

  return _providers;
}

export function setProviders(p: Providers) {
  _providers = p;
}

export async function getProviders(): Promise<Providers> {
  return loadProviders();
}

/**
 * Orchestrates the pipeline:
 *   1) seeds -> 2) websearch -> 3) scorer
 * Returns scored candidates if a scorer exists, otherwise raw candidates.
 */
export async function generateAndScoreCandidates(ctx: any = {}): Promise<any[]> {
  const p = await loadProviders();
  const seedsFn = p.seeds;
  const searchFn = p.websearch;
  const scoreFn = p.scorer;

  // 1) get seeds
  let seeds: any[] = [];
  if (isFn(seedsFn)) {
    const batch = await seedsFn(undefined, ctx);
    if (Array.isArray(batch?.seeds)) seeds = batch.seeds;
    else if (Array.isArray(batch)) seeds = batch;
  }

  // 2) search for each seed
  const limit = ctx?.limitPerSeed ?? 5;
  const candidates: any[] = [];
  if (isFn(searchFn) && seeds.length) {
    for (const s of seeds) {
      const q = s?.query ?? s;
      const results = await searchFn({ query: q, limit }, ctx);
      if (Array.isArray(results)) {
        for (const r of results) {
          candidates.push({
            host: r.host ?? r.domain ?? null,
            url: r.url ?? r.link ?? r.href ?? null,
            title: r.title ?? r.pageTitle ?? null,
            tags: s?.tags ?? [],
            extra: { snippet: r.snippet ?? r.summary ?? null, source: "websearch" },
          });
        }
      }
    }
  }

  // 3) score
  if (!isFn(scoreFn)) return candidates;
  const scored = await scoreFn(candidates, ctx?.scoreOptions ?? undefined, ctx);
  return Array.isArray(scored) ? scored : candidates;
}

/** Re-export types so external code can import from "./providers". */
export * from "./types";

/** Default export for convenience. */
export default {
  loadProviders,
  getProviders,
  setProviders,
  generateAndScoreCandidates,
};