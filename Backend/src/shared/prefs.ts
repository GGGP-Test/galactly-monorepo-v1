// src/shared/prefs.ts
//
// Per-supplier preference "sliders" stored in-memory.
// Safe defaults, normalization, and a tiny API the routes can use.
// You can persist these later (Redis/DB); surface stays the same.

export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

export interface UserPrefs {
  // Who is the supplier (their website)?
  host: string;                 // normalized, used as key

  // Geo preference
  city?: string;                // e.g. "Los Angeles"
  radiusKm?: number;            // future: widen search progressively

  // Size preference knobs
  preferSmallMid?: boolean;     // quick bias switch (default true)
  sizeWeight?: Partial<Record<SizeBucket, number>>; // fine-grain weights

  // Tier emphasis (defaults to ["C","B"])
  tierFocus?: Tier[];

  // Category control (loose, tag-based)
  categoriesAllow?: string[];   // if set, prefer these categories
  categoriesBlock?: string[];   // avoid these categories

  // Signal weights (light nudges)
  signalWeight?: {
    local?: number;             // locality (exact city match)
    ecommerce?: number;         // has ecom tag
    retail?: number;            // has retail tag
    wholesale?: number;         // has wholesale tag
  };

  // Per-click caps the route can honor (keeps UX predictable)
  maxWarm?: number;             // default 5
  maxHot?: number;              // default 1
}

// What routes actually need while scoring:
export interface EffectivePrefs {
  host: string;
  city?: string;
  radiusKm: number;

  // weights resolved to concrete numbers
  sizeWeight: Record<SizeBucket, number>;
  preferSmallMid: boolean;
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
}

// --- in-memory store (can be swapped later) ---
const STORE = new Map<string, UserPrefs>();

// --- helpers ---
export function normalizeHost(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function clamp(n: any, lo: number, hi: number, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

function uniqLower(a?: string[]): string[] {
  const set = new Set<string>();
  for (const s of a || []) {
    const v = String(s || "").toLowerCase().trim();
    if (v) set.add(v);
  }
  return Array.from(set);
}

// Defaults chosen to strongly avoid giants and prefer local, small/mid
export function defaultPrefs(host: string): EffectivePrefs {
  return {
    host,
    city: undefined,
    radiusKm: 50,
    preferSmallMid: true,
    sizeWeight: { micro: 1.2, small: 1.0, mid: 0.6, large: -1.2 },
    tierFocus: ["C", "B"],
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
}

// Merge a partial patch into an existing (or default) pref
export function setPrefs(hostLike: string, patch: Partial<UserPrefs>): EffectivePrefs {
  const host = normalizeHost(hostLike);
  const existing: UserPrefs = STORE.get(host) || { host };

  const merged: UserPrefs = {
    host,
    city: patch.city ?? existing.city,
    radiusKm: patch.radiusKm ?? existing.radiusKm ?? 50,

    preferSmallMid: patch.preferSmallMid ?? existing.preferSmallMid ?? true,
    sizeWeight: {
      ...({} as Record<SizeBucket, number>),
      ...(existing.sizeWeight || {}),
      ...(patch.sizeWeight || {}),
    },

    tierFocus: (patch.tierFocus ?? existing.tierFocus) || ["C", "B"],

    categoriesAllow: uniqLower((patch.categoriesAllow ?? existing.categoriesAllow) || []),
    categoriesBlock: uniqLower((patch.categoriesBlock ?? existing.categoriesBlock) || []),

    signalWeight: {
      local: clamp(patch.signalWeight?.local ?? existing.signalWeight?.local, -3, 3, 1.6),
      ecommerce: clamp(patch.signalWeight?.ecommerce ?? existing.signalWeight?.ecommerce, -1, 1, 0.25),
      retail: clamp(patch.signalWeight?.retail ?? existing.signalWeight?.retail, -1, 1, 0.2),
      wholesale: clamp(patch.signalWeight?.wholesale ?? existing.signalWeight?.wholesale, -1, 1, 0.1),
    },

    maxWarm: clamp(patch.maxWarm ?? existing.maxWarm, 0, 50, 5),
    maxHot: clamp(patch.maxHot ?? existing.maxHot, 0, 5, 1),
  };

  STORE.set(host, merged);
  return toEffective(merged);
}

export function getPrefs(hostLike: string): EffectivePrefs {
  const host = normalizeHost(hostLike);
  const raw = STORE.get(host);
  if (!raw) return defaultPrefs(host);
  return toEffective(raw);
}

function toEffective(u: UserPrefs): EffectivePrefs {
  const host = normalizeHost(u.host);

  const def = defaultPrefs(host);
  const sizeWeight: Record<SizeBucket, number> = {
    micro: clamp(u.sizeWeight?.micro ?? def.sizeWeight.micro, -3, 3, def.sizeWeight.micro),
    small: clamp(u.sizeWeight?.small ?? def.sizeWeight.small, -3, 3, def.sizeWeight.small),
    mid: clamp(u.sizeWeight?.mid ?? def.sizeWeight.mid, -3, 3, def.sizeWeight.mid),
    large: clamp(u.sizeWeight?.large ?? def.sizeWeight.large, -3, 3, def.sizeWeight.large),
  };

  const out: EffectivePrefs = {
    host,
    city: u.city?.trim() || undefined,
    radiusKm: clamp(u.radiusKm, 1, 500, def.radiusKm),

    preferSmallMid: (typeof u.preferSmallMid === "boolean") ? u.preferSmallMid : def.preferSmallMid,
    sizeWeight,

    tierFocus: (u.tierFocus && u.tierFocus.length) ? u.tierFocus : def.tierFocus,

    categoriesAllow: uniqLower(u.categoriesAllow),
    categoriesBlock: uniqLower(u.categoriesBlock),

    signalWeight: {
      local: clamp(u.signalWeight?.local ?? def.signalWeight.local, -3, 3, def.signalWeight.local),
      ecommerce: clamp(u.signalWeight?.ecommerce ?? def.signalWeight.ecommerce, -1, 1, def.signalWeight.ecommerce),
      retail: clamp(u.signalWeight?.retail ?? def.signalWeight.retail, -1, 1, def.signalWeight.retail),
      wholesale: clamp(u.signalWeight?.wholesale ?? def.signalWeight.wholesale, -1, 1, def.signalWeight.wholesale),
    },

    maxWarm: clamp(u.maxWarm, 0, 50, def.maxWarm),
    maxHot: clamp(u.maxHot, 0, 5, def.maxHot),
  };

  return out;
}

// Utility: a simple, readable explanation string you can attach to "why"
export function prefsSummary(p: EffectivePrefs): string {
  const parts: string[] = [];
  if (p.city) parts.push(`city=${p.city}`);
  if (p.tierFocus.length) parts.push(`tier=[${p.tierFocus.join(",")}]`);
  parts.push(
    `sizeW(micro:${p.sizeWeight.micro}, small:${p.sizeWeight.small}, mid:${p.sizeWeight.mid}, large:${p.sizeWeight.large})`,
  );
  if (p.categoriesAllow.length) parts.push(`allow:${p.categoriesAllow.slice(0,5).join(",")}${p.categoriesAllow.length>5?"…":""}`);
  if (p.categoriesBlock.length) parts.push(`block:${p.categoriesBlock.slice(0,5).join(",")}${p.categoriesBlock.length>5?"…":""}`);
  return parts.join(" • ");
}

// (Optional) clear everything — handy in tests
export function __clearPrefs() {
  STORE.clear();
}