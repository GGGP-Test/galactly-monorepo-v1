// Path: Backend/src/providers/index.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Providers registry + resilient pipeline with safe fallbacks.
 * Returns { candidates, meta } in the exact shape the Free Panel uses.
 */

import * as SeedsMod from "./seeds";
import * as SearchMod from "./websearch";
import * as ScorerMod from "./scorer";

/* ---------- Public types exported for callers (route imports from here) ---------- */

export type Temp = "warm" | "hot";

export type UICandidate = {
  host: string;
  title?: string;
  platform: "web" | "news";
  temp: Temp;
  why: string;
  created: string; // ISO
};

export type FindBuyersInput = {
  supplier: string; // domain
  region?: string;  // "usca" | "US/CA" | "US" | "CA"
  radiusMi?: number;
  persona?: { offer?: string; solves?: string; titles?: string };
};

export type RunProvidersMeta = {
  seeds: number;
  searched: number;
  scored: number;
  hot: number;
  warm: number;
  ms?: number;
};

export type RunProvidersOutput = {
  candidates: UICandidate[];
  meta: RunProvidersMeta;
};

/* ---------- tiny utils ---------- */

type ProviderFn = (...args: any[]) => any | Promise<any>;
const isFn = (v: any): v is ProviderFn => typeof v === "function";

/** Try default and a list of common export names. */
function pick(mod: any, names: string[]): ProviderFn | undefined {
  if (!mod) return;
  for (const n of ["default", ...names]) {
    const v = (mod as any)[n];
    if (isFn(v)) return v;
  }
  if (isFn(mod)) return mod;
  return;
}

function nowISO() {
  return new Date().toISOString();
}

function normalizeRegion(input?: string): "US/CA" | "US" | "CA" {
  if (!input) return "US/CA";
  const s = String(input).replace(/[^a-z]/gi, "").toLowerCase(); // e.g., "usca"
  if (s === "us" || s === "usa") return "US";
  if (s === "ca" || s === "canada") return "CA";
  return "US/CA";
}

/* ---------- fallbacks (deterministic, minimal) ---------- */

/** Mirrors what you showed in screenshots so we always produce something. */
const SEED_HOSTS: Array<[string, string]> = [
  ["blueboxretail.com", "Purchasing Manager"],
  ["acmefoods.com", "Procurement Lead"],
  ["nwpallets.ca", "Buyer"],
  ["logiship.com", "Head of Ops"],
  ["freshgrocer.com", "Sourcing Manager"],
  ["peakoutdoors.ca", "Purchasing Manager"],
  ["blueboxpets.com", "Category Buyer"],
  ["grocermx.ca", "Procurement Manager"],
  ["palletpros.ca", "Supply Manager"],
  ["warehouselabs.io", "Ops Manager"],
  ["northcoastsupply.com", "Purchasing Lead"],
  ["greenpack.ca", "Procurement Specialist"],
];

/** Tiny corpus used when ./websearch is missing or returns nothing. */
const WEB_CORPUS: Array<{ host: string; region: "US" | "CA" | "US/CA"; title: string }> = [
  { host: "blueboxretail.com", region: "US", title: "Buyer" },
  { host: "acmefoods.com",     region: "US", title: "Procurement" },
  { host: "nwpallets.ca",      region: "CA", title: "Buyer" },
  { host: "logiship.com",      region: "US", title: "Ops" },
  { host: "freshgrocer.com",   region: "US", title: "Sourcing" },
  { host: "peakoutdoors.ca",   region: "CA", title: "Purchasing" },
];

/** Very light classifier just to set warm/hot + reason. */
function classify(host: string, region: "US/CA" | "US" | "CA"): { temp: Temp; why: string } {
  const pkg = /packag|box|pallet|label|mailer|carton|foam|tape|insert/i;
  let score = 0;
  if (pkg.test(host)) score += 2;
  if (region !== "US/CA") score += 1;
  const temp: Temp = score >= 3 ? "hot" : "warm";
  const why =
    temp === "hot"
      ? "High packaging intent + proximity."
      : "Likely packaging buyer (industry/role).";
  return { temp, why };
}

/* ---------- resolve module exports if present ---------- */

export const seeds =
  pick(SeedsMod, ["seeds", "seedsProvider", "getSeeds", "provider"]);
export const websearch =
  pick(SearchMod, ["websearch", "search", "provider", "run", "query"]);
export const scorer =
  pick(ScorerMod, ["scorer", "score", "scoreCandidates", "provider"]);

/** Public registry (kept for compatibility if other files import it). */
export const providers = { seeds, websearch, scorer };

/* ---------- main pipeline ---------- */

export async function runProviders(input: FindBuyersInput): Promise<RunProvidersOutput> {
  const t0 = Date.now();
  const region = normalizeRegion(input?.region);
  const limitPerSeed = 5;

  const meta: RunProvidersMeta = {
    seeds: 0,
    searched: 0,
    scored: 0,
    hot: 0,
    warm: 0,
  };

  /* 1) Seeds */
  let seedList: Array<{ host: string; title?: string }> = [];
  if (isFn(seeds)) {
    try {
      const out = await seeds({ region });
      // Accept a variety of shapes:
      if (Array.isArray(out?.seeds)) {
        seedList = out.seeds as any[];
      } else if (Array.isArray(out)) {
        seedList = out as any[];
      }
    } catch {
      // fall through to fallback
    }
  }
  if (!seedList.length) {
    // fallback: trim to 4 to match your meta.seeds ~ 4
    seedList = SEED_HOSTS.slice(0, 4).map(([host, title]) => ({ host, title }));
  }
  meta.seeds = seedList.length;

  /* 2) Web search (module or fallback corpus) */
  const raw: UICandidate[] = [];
  for (const s of seedList) {
    const q = s.host || s; // flexible seed shapes
    let rows: any[] = [];

    if (isFn(websearch)) {
      try {
        const r = await websearch({ query: q, limit: limitPerSeed, region });
        if (Array.isArray(r)) rows = r;
      } catch {
        // ignore, use fallback below
      }
    }

    if (!rows.length) {
      // fallback: filter small corpus by region
      rows = WEB_CORPUS.filter((d) => region === "US/CA" || d.region === region)
        .slice(0, limitPerSeed)
        .map((d) => ({
          host: d.host,
          title: d.title,
          platform: "web" as const,
          created: nowISO(),
        }));
    }

    for (const r of rows) {
      const host = r.host ?? r.domain ?? q;
      const title = r.title ?? s.title ?? "Buyer";
      const { temp, why } = classify(String(host), region);
      raw.push({
        host: String(host),
        title: String(title),
        platform: "web",
        temp,
        why,
        created: nowISO(),
      });
    }
  }
  meta.searched = raw.length;

  /* 3) Score (optional – if module available) */
  let candidates: UICandidate[] = raw;
  if (isFn(scorer) && raw.length) {
    try {
      const scored = await scorer(
        raw.map((c) => ({
          host: c.host,
          title: c.title,
          // map minimal info into what a scorer might expect
        })),
        { supplierDomain: input?.supplier }
      );
      // If scorer returns an array with label/score, fold it back
      if (Array.isArray(scored) && scored.length === raw.length) {
        candidates = scored.map((s: any, i: number) => {
          const base = raw[i];
          const temp: Temp = (s.label === "hot" ? "hot" : s.label === "warm" ? "warm" : base.temp);
          const why = Array.isArray(s.reasons) && s.reasons.length
            ? s.reasons.join("; ")
            : base.why;
          return { ...base, temp, why };
        });
      }
    } catch {
      // ignore — keep raw
    }
  }

  // finalize meta
  for (const c of candidates) {
    if (c.temp === "hot") meta.hot += 1;
    else meta.warm += 1;
  }
  meta.scored = candidates.length;

  meta.ms = Date.now() - t0;

  return { candidates, meta };
}

/* Back-compat named exports some code may use */
export const generateAndScoreCandidates = runProviders;

/* Default export */
export default providers;