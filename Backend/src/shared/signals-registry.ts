// src/shared/signals-registry.ts
//
// Artemis-B v1 — lightweight registry to run text-based signal extractors
// in one place. Dynamic, dependency-free, tolerant of missing modules.
// Works in CJS/ESM builds produced by TypeScript (we only touch `require`).
//
// Exports:
//   - getRegistry(): Record<string,(text:string)=>any>
//   - runAll(text: string, onlyKeys?: string[]): { ok:true; results:Record<string,any>; reasons:string[] }
//   - has(key): boolean
//
// Notes:
// - This registry is "best effort": for each module we try several function
//   names (extractX / analyzeX / extract). We normalize {score,reasons[]} when
//   possible but always return the raw object under results[key].

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types */

type Runner = (text: string) => any;

function lc(v: any) { return String(v ?? "").toLowerCase().trim(); }
function clamp01(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function asReasons(x: any): string[] {
  if (Array.isArray(x)) return x.map((s) => String(s)).filter(Boolean).slice(0, 12);
  return [];
}
function pick<T extends object>(o: any, keys: (keyof any)[]): any {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) if (k in o) return (o as any)[k];
  return undefined;
}

function tryRequire(path: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path);
  } catch { return null; }
}

function buildRunner(modPath: string, fnCandidates: string[], scoreKeys: string[], summaryFn?: string): Runner | null {
  const mod = tryRequire(modPath) || tryRequire(modPath + ".js");
  if (!mod) return null;

  // pick the first available function
  let fn: Function | null = null;
  for (const name of fnCandidates) {
    const f = (mod as any)[name] || (mod as any).default?.[name] || (typeof (mod as any).default === "function" && name === "extract" ? (mod as any).default : undefined);
    if (typeof f === "function") { fn = f; break; }
  }
  if (!fn) return null;

  const summarize = summaryFn && (mod as any)[summaryFn];

  return (text: string) => {
    const raw = fn!(String(text || ""));
    // Normalize if possible
    const scoreRaw =
      pick(raw, ["score", ...scoreKeys]) ??
      pick((raw || {}), ["signal", "strength"]);
    const score = clamp01(scoreRaw);

    const reasons =
      asReasons(raw?.reasons) ||
      (typeof summarize === "function" ? [String(summarize(raw))] : []);

    return { ...raw, score, reasons };
  };
}

// ----------------------------- registry table ------------------------------

/**
 * Each entry describes:
 *   key        -> report key users/routers will reference
 *   mod        -> relative module path in src/shared/*
 *   fns        -> function name candidates to call
 *   scoreKeys  -> preferred numeric fields to map into score (0..1)
 *   summary    -> optional summarize function name for fallback reason
 *
 * If a module or function is missing, the entry is skipped.
 */
const ENTRIES: Array<{
  key: string;
  mod: string;
  fns: string[];
  scoreKeys: string[];
  summary?: string;
}> = [
  { key: "tech",          mod: "./tech",           fns: ["extractTech", "analyzeTech", "extract"],        scoreKeys: ["techScore", "platformScore"],     summary: "summarizeTech" },
  { key: "inventory",     mod: "./inventory",      fns: ["extractInventory", "analyzeInventory", "extract"], scoreKeys: ["inventoryScore"],                summary: "summarizeInventory" },
  { key: "hiring",        mod: "./hiring",         fns: ["extractHiring", "analyzeHiring", "extract"],    scoreKeys: ["hiringScore"],                    summary: "summarizeHiring" },
  { key: "geo",           mod: "./geo",            fns: ["extractGeo", "extractGeoPresence", "extract"],  scoreKeys: ["geoScore", "presenceScore"],      summary: "summarizeGeo" },
  { key: "promo",         mod: "./promo",          fns: ["extractPromotions", "extractPromo", "extract"], scoreKeys: ["promoScore"],                     summary: "summarizePromotions" },
  { key: "specs",         mod: "./specs",          fns: ["extractSpecs", "analyzeSpecs", "extract"],      scoreKeys: ["specsScore"],                     summary: "summarizeSpecs" },
  { key: "marketplaces",  mod: "./marketplaces",   fns: ["extractMarketplaces", "extract", "analyzeMarketplace"], scoreKeys: ["marketplaceScore"],     summary: "summarizeMarketplaces" },
  { key: "stockists",     mod: "./stockists",      fns: ["extractStockists", "extract", "analyzeStockists"], scoreKeys: ["stockistScore"],               summary: "summarizeStockists" },
  { key: "partners",      mod: "./partners",       fns: ["extractPartners", "extract"],                   scoreKeys: ["partnerScore"],                   summary: "summarizePartners" },
  { key: "tradeflow",     mod: "./tradeflow",      fns: ["extractTradeflow", "extract"],                  scoreKeys: ["tradeScore", "tradeflowScore"],   summary: "summarizeTradeflow" },
  { key: "socialproof",   mod: "./socialproof",    fns: ["extractSocialProof", "extract"],                scoreKeys: ["socialScore", "proofScore"],      summary: "summarizeSocialProof" },
  { key: "support",       mod: "./support",        fns: ["extractSupport", "extract"],                    scoreKeys: ["supportScore"],                   summary: "summarizeSupport" },
  { key: "contactability",mod: "./contactability", fns: ["extractContactability", "analyzeContactability", "extract"], scoreKeys: ["contactScore"],     summary: "summarizeContactability" },
  // Optional bilingual sugar — will be ignored if file is absent:
  { key: "signals_es",    mod: "./signals.es",     fns: ["extractSignalsEs", "extract"],                  scoreKeys: ["score"],                          summary: "summarizeSignalsEs" },
];

// Lazy-built singletons
let _registry: Record<string, Runner> | null = null;

export function getRegistry(): Record<string, Runner> {
  if (_registry) return _registry;

  const reg: Record<string, Runner> = {};
  for (const e of ENTRIES) {
    const runner =
      buildRunner(e.mod, e.fns, e.scoreKeys, e.summary) ||
      // Final attempt: default export as a function
      (() => {
        const mod = tryRequire(e.mod) || tryRequire(e.mod + ".js");
        const def = mod?.default;
        if (typeof def === "function") {
          return (text: string) => {
            const raw = def(String(text || ""));
            const score = clamp01(pick(raw, ["score", ...e.scoreKeys]));
            return { ...raw, score, reasons: asReasons(raw?.reasons) };
          };
        }
        return null;
      })();

    if (runner) reg[e.key] = runner;
  }

  _registry = reg;
  return _registry;
}

export function has(key: string): boolean {
  return !!getRegistry()[lc(key)];
}

export function runAll(text: string, onlyKeys?: string[]): { ok: true; results: Record<string, any>; reasons: string[] } {
  const reg = getRegistry();
  const keys = (onlyKeys && onlyKeys.length ? onlyKeys : Object.keys(reg)).map(lc).filter((k) => reg[k]);
  const results: Record<string, any> = {};
  const reasons: string[] = [];

  for (const k of keys) {
    try {
      const out = reg[k](text);
      results[k] = out;
      const pct = typeof out?.score === "number" ? `${Math.round(out.score * 100)}%` : "";
      const why = Array.isArray(out?.reasons) && out.reasons.length ? ` — ${out.reasons[0]}` : "";
      reasons.push(`${k}:${pct}${why}`);
    } catch (err: any) {
      results[k] = { error: String(err?.message || err || "failed") };
      reasons.push(`${k}:error`);
    }
  }
  return { ok: true, results, reasons: reasons.slice(0, 16) };
}

export default { getRegistry, runAll, has };