// src/shared/prefs.ts
//
// Single source of truth for buyer/supplier preferences (effective persona).
// Deterministic, dependency-free, in-memory store with sane defaults.
// Designed to be compatible with routes/leads.ts, routes/prefs.ts, and shared/trc.ts.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

/** Numeric sliders that must never be undefined. */
export type SizeWeight = {
  micro: number;
  small: number;
  mid: number;
  large: number;
};

export type SignalWeight = {
  local: number;
  ecommerce: number;
  retail: number;
  wholesale: number;
};

export interface EffectivePrefs {
  host: string;

  // light targeting
  city?: string;                 // normalized host-level city preference
  preferSmallMid: boolean;       // convenience flag (also reflected in sizeWeight)

  // numeric knobs (always numbers)
  sizeWeight: SizeWeight;
  signalWeight: SignalWeight;

  // category/tag steering (lowercase, unique)
  categoriesAllow: string[];
  categoriesBlock: string[];

  // directory / marketplace flag
  inboundOptIn: boolean;

  // Optional overlays used by trc.ts (forwarded if present)
  titlesPreferred?: string[];
  materialsAllow?: string[];
  materialsBlock?: string[];
  certsRequired?: string[];
  excludeHosts?: string[];
  keywordsAdd?: string[];
  keywordsAvoid?: string[];

  // Legacy helper some old code reads (not relied upon by types)
  // likeTags?: string[];  // <- we compute but keep off the interface to avoid strict drift
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function clamp(n: unknown, lo: number, hi: number, fb: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fb;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function lowerUniq(arr: unknown, cap = 48): string[] {
  const out = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v ?? "").toLowerCase().trim();
      if (s) out.add(s);
      if (out.size >= cap) break;
    }
  }
  return [...out];
}

export function normalizeHost(raw?: string): string {
  const h = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : "";
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

function defaultSizeWeight(preferSmallMid = true): SizeWeight {
  // Tuned to pair nicely with shared/trc.ts defaults
  return {
    micro: preferSmallMid ? 1.2 : 0.6,
    small: preferSmallMid ? 1.0 : 0.6,
    mid:   preferSmallMid ? 0.6 : 0.8,
    large: preferSmallMid ? -1.2 : 0.2,
  };
}

function defaultSignalWeight(near = true): SignalWeight {
  return {
    local:     near ? 1.6 : 0.2,
    ecommerce: 0.25,
    retail:    0.2,
    wholesale: 0.1,
  };
}

export function defaultPrefs(host: string): EffectivePrefs {
  const norm = normalizeHost(host) || "yourcompany.com";
  const preferSmallMid = true;
  const base: EffectivePrefs = {
    host: norm,
    city: undefined,
    preferSmallMid,
    sizeWeight: defaultSizeWeight(preferSmallMid),
    signalWeight: defaultSignalWeight(true),
    categoriesAllow: [],
    categoriesBlock: [],
    inboundOptIn: false,
  };
  // legacy helper (not typed): mirror categoriesAllow
  (base as any).likeTags = base.categoriesAllow;
  return base;
}

/* -------------------------------------------------------------------------- */
/* In-memory store                                                             */
/* -------------------------------------------------------------------------- */

const STORE = new Map<string, EffectivePrefs>();

function ensure(host: string): EffectivePrefs {
  const h = normalizeHost(host);
  if (!h) return defaultPrefs("yourcompany.com");
  const cur = STORE.get(h);
  if (cur) return cur;
  const d = defaultPrefs(h);
  STORE.set(h, d);
  return d;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

// Legacy aliases some routes probe for
export function get(host: string): EffectivePrefs { return ensure(host); }
export function getPrefs(host: string): EffectivePrefs { return ensure(host); }
export function getEffective(host: string): EffectivePrefs { return ensure(host); }
export function getEffectivePrefs(host: string): EffectivePrefs { return ensure(host); }

/**
 * Apply a patch (typically from routes/prefs.toPrefsPatch()).
 * All numeric fields are clamped to numbers, arrays are normalized to lowercase uniques.
 */
export function setPrefs(host: string, patch: Partial<EffectivePrefs> & Record<string, any>): EffectivePrefs {
  const h = normalizeHost(host);
  if (!h) return defaultPrefs("yourcompany.com");

  const cur = ensure(h);

  // preferSmallMid toggles the default shape for sizeWeight when missing
  const preferSmallMid = typeof patch.preferSmallMid === "boolean" ? patch.preferSmallMid : cur.preferSmallMid;

  // Construct new numeric blocks (no undefined allowed)
  const sizeWeight: SizeWeight = {
    micro: clamp(patch?.sizeWeight?.micro, -3, 3, cur.sizeWeight.micro ?? defaultSizeWeight(preferSmallMid).micro),
    small: clamp(patch?.sizeWeight?.small, -3, 3, cur.sizeWeight.small ?? defaultSizeWeight(preferSmallMid).small),
    mid:   clamp(patch?.sizeWeight?.mid,   -3, 3, cur.sizeWeight.mid   ?? defaultSizeWeight(preferSmallMid).mid),
    large: clamp(patch?.sizeWeight?.large, -3, 3, cur.sizeWeight.large ?? defaultSizeWeight(preferSmallMid).large),
  };

  const signalWeight: SignalWeight = {
    local:     clamp(patch?.signalWeight?.local,     -3, 3, cur.signalWeight.local     ?? defaultSignalWeight(true).local),
    ecommerce: clamp(patch?.signalWeight?.ecommerce, -1, 1, cur.signalWeight.ecommerce ?? defaultSignalWeight(true).ecommerce),
    retail:    clamp(patch?.signalWeight?.retail,    -1, 1, cur.signalWeight.retail    ?? defaultSignalWeight(true).retail),
    wholesale: clamp(patch?.signalWeight?.wholesale, -1, 1, cur.signalWeight.wholesale ?? defaultSignalWeight(true).wholesale),
  };

  const next: EffectivePrefs = {
    host: h,
    city: (patch.city ?? cur.city)?.toString().trim() || undefined,
    preferSmallMid,
    sizeWeight,
    signalWeight,
    categoriesAllow: lowerUniq(patch.categoriesAllow ?? cur.categoriesAllow),
    categoriesBlock: lowerUniq(patch.categoriesBlock ?? cur.categoriesBlock),
    inboundOptIn: Boolean(patch.inboundOptIn ?? cur.inboundOptIn),

    // Optional overlays: forward only if arrays; otherwise keep existing if any
    titlesPreferred: Array.isArray(patch.titlesPreferred) ? lowerUniq(patch.titlesPreferred) : cur.titlesPreferred,
    materialsAllow:  Array.isArray(patch.materialsAllow)  ? lowerUniq(patch.materialsAllow)  : cur.materialsAllow,
    materialsBlock:  Array.isArray(patch.materialsBlock)  ? lowerUniq(patch.materialsBlock)  : cur.materialsBlock,
    certsRequired:   Array.isArray(patch.certsRequired)   ? lowerUniq(patch.certsRequired)   : cur.certsRequired,
    excludeHosts:    Array.isArray(patch.excludeHosts)    ? lowerUniq(patch.excludeHosts)    : cur.excludeHosts,
    keywordsAdd:     Array.isArray(patch.keywordsAdd)     ? lowerUniq(patch.keywordsAdd)     : cur.keywordsAdd,
    keywordsAvoid:   Array.isArray(patch.keywordsAvoid)   ? lowerUniq(patch.keywordsAvoid)   : cur.keywordsAvoid,
  };

  // legacy mirror to help any heuristic code: categoriesAllow -> likeTags
  (next as any).likeTags = next.categoriesAllow;

  STORE.set(h, next);
  return next;
}

/** One-line human summary for UIs. */
export function prefsSummary(p: EffectivePrefs): string {
  const bits: string[] = [];
  if (p.city) bits.push(`city:${p.city}`);
  const cats = p.categoriesAllow.slice(0, 4);
  if (cats.length) bits.push(`focus:${cats.join("/")}`);
  bits.push(`size[μ:${p.sizeWeight.micro.toFixed(1)}, s:${p.sizeWeight.small.toFixed(1)}, m:${p.sizeWeight.mid.toFixed(1)}, L:${p.sizeWeight.large.toFixed(1)}]`);
  bits.push(`local:${p.signalWeight.local.toFixed(1)}`);
  if (p.inboundOptIn) bits.push("inbound:yes");
  return bits.join(" • ");
}

/** Testing/ops escape hatch. */
export function __clearPrefsStore() { STORE.clear(); }