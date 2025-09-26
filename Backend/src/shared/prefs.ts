// src/shared/prefs.ts
//
// Preference model shared by routes and (optionally) front-ends.
// Exports the exact symbols the prefs route expects:
//
//   - Prefs, PrefsInput
//   - DEFAULT_PREFS
//   - normalizePrefs
//   - normalizeHost (utility)
//   - prefsSummary (utility)

export type Tier = 'A' | 'B' | 'C';
export type SizeBucket = 'micro' | 'small' | 'mid' | 'large';

export interface PrefsInput {
  host?: string;                // supplier domain (any format; we'll normalize)
  city?: string;                // preferred city bias
  radiusKm?: number;            // search expansion hint

  // knobs to avoid giants and prefer approachable buyers
  preferSmallMid?: boolean;     // coarse toggle (default true)
  sizeWeight?: Partial<Record<SizeBucket, number>>; // fine weights

  tierFocus?: Tier[];           // default ["C","B"]

  // tag/category nudges
  categoriesAllow?: string[];
  categoriesBlock?: string[];

  // signal weights (light nudges)
  signalWeight?: {
    local?: number;             // exact city match
    ecommerce?: number;         // ecom presence
    retail?: number;            // retail presence
    wholesale?: number;         // wholesale presence
  };

  // caps
  maxWarm?: number;             // default 5
  maxHot?: number;              // default 1
}

export interface Prefs {
  host: string;
  city?: string;
  radiusKm: number;

  preferSmallMid: boolean;
  sizeWeight: Record<SizeBucket, number>;
  tierFocus: Tier[];

  categoriesAllow: string[];
  categoriesBlock: string[];

  signalWeight: {
    local: number;
    ecommerce: number;
    retail: number;
    wholesale: number;
  };

  maxWarm: number;
  maxHot: number;

  updatedAt?: string;
}

/* ----------------------------------------------------------------------------
 * Utilities
 * --------------------------------------------------------------------------*/

export function normalizeHost(input: string | undefined): string {
  return String(input || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

function uniqLower(a?: string[]): string[] {
  const set = new Set<string>();
  for (const s of a || []) {
    const v = String(s || '').toLowerCase().trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

function fillSizeWeights(
  src: Partial<Record<SizeBucket, number>> | undefined,
  base: Record<SizeBucket, number>
): Record<SizeBucket, number> {
  return {
    micro: clamp(src?.micro, -3, 3, base.micro),
    small: clamp(src?.small, -3, 3, base.small),
    mid: clamp(src?.mid, -3, 3, base.mid),
    large: clamp(src?.large, -3, 3, base.large),
  };
}

/* ----------------------------------------------------------------------------
 * Defaults (strong bias for Tier C / small-mid, local-first)
 * --------------------------------------------------------------------------*/

export const DEFAULT_PREFS: Prefs = {
  host: 'default',
  city: undefined,
  radiusKm: 50,

  preferSmallMid: true,
  sizeWeight: { micro: 1.2, small: 1.0, mid: 0.6, large: -1.2 },

  tierFocus: ['C', 'B'],

  categoriesAllow: [],
  categoriesBlock: [],

  signalWeight: {
    local: 1.6,
    ecommerce: 0.25,
    retail: 0.2,
    wholesale: 0.1,
  },

  maxWarm: 5,
  maxHot: 1,
};

/* ----------------------------------------------------------------------------
 * Normalization (merge + clamp)
 * --------------------------------------------------------------------------*/

export function normalizePrefs(
  patch: PrefsInput | undefined,
  base: Prefs = DEFAULT_PREFS
): Prefs {
  const p = patch || {};
  const host = normalizeHost(p.host) || base.host;

  const sizeWeight = fillSizeWeights(p.sizeWeight, base.sizeWeight);

  const tierFocus =
    (Array.isArray(p.tierFocus) && p.tierFocus.length
      ? p.tierFocus
      : base.tierFocus
    ).filter(Boolean) as Tier[];

  const out: Prefs = {
    host,
    city: (p.city ?? base.city)?.trim() || undefined,
    radiusKm: clamp(p.radiusKm ?? base.radiusKm, 1, 500, base.radiusKm),

    preferSmallMid:
      typeof p.preferSmallMid === 'boolean' ? p.preferSmallMid : base.preferSmallMid,

    sizeWeight,

    tierFocus,

    categoriesAllow: uniqLower(p.categoriesAllow ?? base.categoriesAllow),
    categoriesBlock: uniqLower(p.categoriesBlock ?? base.categoriesBlock),

    signalWeight: {
      local: clamp(p.signalWeight?.local ?? base.signalWeight.local, -3, 3, base.signalWeight.local),
      ecommerce: clamp(p.signalWeight?.ecommerce ?? base.signalWeight.ecommerce, -1, 1, base.signalWeight.ecommerce),
      retail: clamp(p.signalWeight?.retail ?? base.signalWeight.retail, -1, 1, base.signalWeight.retail),
      wholesale: clamp(p.signalWeight?.wholesale ?? base.signalWeight.wholesale, -1, 1, base.signalWeight.wholesale),
    },

    maxWarm: clamp(p.maxWarm ?? base.maxWarm, 0, 50, base.maxWarm),
    maxHot: clamp(p.maxHot ?? base.maxHot, 0, 5, base.maxHot),

    updatedAt: new Date().toISOString(),
  };

  return out;
}

/* ----------------------------------------------------------------------------
 * Pretty summary for logs / UI badges
 * --------------------------------------------------------------------------*/

export function prefsSummary(p: Prefs): string {
  const parts: string[] = [];
  if (p.city) parts.push(`city=${p.city}`);
  if (p.tierFocus.length) parts.push(`tier=[${p.tierFocus.join(',')}]`);
  parts.push(
    `sizeW(m:${p.sizeWeight.micro}, s:${p.sizeWeight.small}, mid:${p.sizeWeight.mid}, L:${p.sizeWeight.large})`
  );
  if (p.categoriesAllow.length)
    parts.push(`allow:${p.categoriesAllow.slice(0, 5).join(',')}${p.categoriesAllow.length > 5 ? '…' : ''}`);
  if (p.categoriesBlock.length)
    parts.push(`block:${p.categoriesBlock.slice(0, 5).join(',')}${p.categoriesBlock.length > 5 ? '…' : ''}`);
  return parts.join(' • ');
}