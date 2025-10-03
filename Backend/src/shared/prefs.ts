// src/shared/prefs.ts
// In-memory preferences/persona store with sane defaults.
// Pure TS, no DB. Compatible with existing routes and scorers.
//
// Exposes (compat-friendly):
//  - normalizeHost(host)
//  - setPrefs(host, patch) => EffectivePrefs
//  - getPrefs(host)        => EffectivePrefs
//  - getEffective(host)    => EffectivePrefs
//  - getEffectivePrefs(host)=> EffectivePrefs
//  - get(host)             => EffectivePrefs
//  - prefsSummary(prefs)   => string
//
// Also exports types Tier, SizeBucket, EffectivePrefs.

export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

type SignalKeys = "local" | "ecommerce" | "retail" | "wholesale";

export interface EffectivePrefs {
  // geo
  city?: string;

  // sizing & signals (fully populated + clamped)
  preferSmallMid: boolean;
  sizeWeight: Record<SizeBucket, number>;
  signalWeight: Record<SignalKeys, number>;

  // category/keyword targeting
  categoriesAllow: string[];
  titlesPreferred: string[];
  materialsAllow: string[];
  materialsBlock: string[];
  certsRequired: string[];
  excludeHosts: string[];
  keywordsAdd: string[];
  keywordsAvoid: string[];

  // directory/inbound
  inboundOptIn: boolean;
}

/** Partial patch accepted from the API/UI */
export type PrefsPatch = Partial<{
  city: string;
  preferSmallMid: boolean;
  sizeWeight: Partial<Record<SizeBucket, number>>;
  signalWeight: Partial<Record<SignalKeys, number>>;
  categoriesAllow: string[];
  titlesPreferred: string[];
  materialsAllow: string[];
  materialsBlock: string[];
  certsRequired: string[];
  excludeHosts: string[];
  keywordsAdd: string[];
  keywordsAvoid: string[];
  inboundOptIn: boolean;
}>;

/* -------------------------------- utils ----------------------------------- */

export function normalizeHost(input: string): string {
  const h = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return /^[a-z0-9.-]+$/.test(h) ? h : "";
}

function clamp(n: unknown, lo: number, hi: number, fb: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fb;
  return Math.max(lo, Math.min(hi, x));
}

function uniqLower(list: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(list)) {
    for (const v of list) {
      const s = String(v ?? "").trim().toLowerCase();
      if (s) out.add(s);
    }
  }
  return [...out];
}

/* ------------------------------ defaults ---------------------------------- */

// Defaults line up with trc.ts fallbacks, so results are stable even if
// some fields are missing in the store.
const DEFAULTS: EffectivePrefs = {
  city: undefined,

  preferSmallMid: true,

  sizeWeight: {
    micro: 1.2,
    small: 1.0,
    mid: 0.6,
    large: -1.2,
  },

  signalWeight: {
    local: 1.6,
    ecommerce: 0.25,
    retail: 0.2,
    wholesale: 0.1,
  },

  categoriesAllow: [],
  titlesPreferred: [],
  materialsAllow: [],
  materialsBlock: [],
  certsRequired: [],
  excludeHosts: [],
  keywordsAdd: [],
  keywordsAvoid: [],

  inboundOptIn: false,
};

/* ---------------------------- in-memory store ------------------------------ */

type RawPrefs = Partial<EffectivePrefs>;
const STORE = new Map<string, RawPrefs>();

/* ----------------------------- normalization ------------------------------ */

function toEffective(raw: RawPrefs | undefined): EffectivePrefs {
  const r = raw || {};

  const sizeWeight: Record<SizeBucket, number> = {
    micro: clamp(r.sizeWeight?.micro, -3, 3, DEFAULTS.sizeWeight.micro),
    small: clamp(r.sizeWeight?.small, -3, 3, DEFAULTS.sizeWeight.small),
    mid: clamp(r.sizeWeight?.mid, -3, 3, DEFAULTS.sizeWeight.mid),
    large: clamp(r.sizeWeight?.large, -3, 3, DEFAULTS.sizeWeight.large),
  };

  const signalWeight: Record<SignalKeys, number> = {
    local: clamp(r.signalWeight?.local, -3, 3, DEFAULTS.signalWeight.local),
    ecommerce: clamp(r.signalWeight?.ecommerce, -3, 3, DEFAULTS.signalWeight.ecommerce),
    retail: clamp(r.signalWeight?.retail, -3, 3, DEFAULTS.signalWeight.retail),
    wholesale: clamp(r.signalWeight?.wholesale, -3, 3, DEFAULTS.signalWeight.wholesale),
  };

  return {
    city: (r.city || "").trim() || undefined,

    preferSmallMid: r.preferSmallMid ?? DEFAULTS.preferSmallMid,
    sizeWeight,
    signalWeight,

    categoriesAllow: uniqLower(r.categoriesAllow || DEFAULTS.categoriesAllow),
    titlesPreferred: uniqLower(r.titlesPreferred || DEFAULTS.titlesPreferred),
    materialsAllow: uniqLower(r.materialsAllow || DEFAULTS.materialsAllow),
    materialsBlock: uniqLower(r.materialsBlock || DEFAULTS.materialsBlock),
    certsRequired: uniqLower(r.certsRequired || DEFAULTS.certsRequired),
    excludeHosts: uniqLower(r.excludeHosts || DEFAULTS.excludeHosts),
    keywordsAdd: uniqLower(r.keywordsAdd || DEFAULTS.keywordsAdd),
    keywordsAvoid: uniqLower(r.keywordsAvoid || DEFAULTS.keywordsAvoid),

    inboundOptIn: Boolean(r.inboundOptIn),
  };
}

/* --------------------------------- API ------------------------------------ */

export function setPrefs(hostRaw: string, patch: PrefsPatch): EffectivePrefs {
  const host = normalizeHost(hostRaw);
  if (!host) throw new Error("bad_host");

  const cur = STORE.get(host) || {};
  const next: RawPrefs = { ...cur };

  if (typeof patch.city === "string") next.city = patch.city.trim() || undefined;
  if (typeof patch.preferSmallMid === "boolean") next.preferSmallMid = patch.preferSmallMid;

  if (patch.sizeWeight) {
    next.sizeWeight = {
      micro: patch.sizeWeight.micro ?? cur.sizeWeight?.micro,
      small: patch.sizeWeight.small ?? cur.sizeWeight?.small,
      mid: patch.sizeWeight.mid ?? cur.sizeWeight?.mid,
      large: patch.sizeWeight.large ?? cur.sizeWeight?.large,
    };
  }

  if (patch.signalWeight) {
    next.signalWeight = {
      local: patch.signalWeight.local ?? cur.signalWeight?.local,
      ecommerce: patch.signalWeight.ecommerce ?? cur.signalWeight?.ecommerce,
      retail: patch.signalWeight.retail ?? cur.signalWeight?.retail,
      wholesale: patch.signalWeight.wholesale ?? cur.signalWeight?.wholesale,
    };
  }

  if (patch.categoriesAllow) next.categoriesAllow = uniqLower(patch.categoriesAllow);
  if (patch.titlesPreferred) next.titlesPreferred = uniqLower(patch.titlesPreferred);
  if (patch.materialsAllow) next.materialsAllow = uniqLower(patch.materialsAllow);
  if (patch.materialsBlock) next.materialsBlock = uniqLower(patch.materialsBlock);
  if (patch.certsRequired) next.certsRequired = uniqLower(patch.certsRequired);
  if (patch.excludeHosts) next.excludeHosts = uniqLower(patch.excludeHosts);
  if (patch.keywordsAdd) next.keywordsAdd = uniqLower(patch.keywordsAdd);
  if (patch.keywordsAvoid) next.keywordsAvoid = uniqLower(patch.keywordsAvoid);

  if (typeof patch.inboundOptIn === "boolean") next.inboundOptIn = patch.inboundOptIn;

  STORE.set(host, next);
  return toEffective(next);
}

export function getPrefs(hostRaw: string): EffectivePrefs {
  const host = normalizeHost(hostRaw);
  if (!host) return { ...DEFAULTS };
  return toEffective(STORE.get(host));
}

// --- compatibility shims used by various routes ---
export const getEffective = getPrefs;
export const getEffectivePrefs = getPrefs;
/** Some legacy code calls Prefs.get(host) */
export const get = getPrefs;

export function prefsSummary(p: EffectivePrefs): string {
  const bits: string[] = [];
  if (p.city) bits.push(`near ${p.city}`);
  if (p.categoriesAllow.length) bits.push(`${p.categoriesAllow.slice(0, 4).join(", ")}`);
  bits.push(
    `size[micro:${p.sizeWeight.micro.toFixed(2)}, small:${p.sizeWeight.small.toFixed(2)}, mid:${p.sizeWeight.mid.toFixed(2)}, large:${p.sizeWeight.large.toFixed(2)}]`
  );
  bits.push(
    `signal[local:${p.signalWeight.local.toFixed(2)}, ecom:${p.signalWeight.ecommerce.toFixed(2)}, retail:${p.signalWeight.retail.toFixed(2)}, wholesale:${p.signalWeight.wholesale.toFixed(2)}]`
  );
  if (p.inboundOptIn) bits.push("inbound:yes");
  return bits.join(" • ");
}

export default {
  normalizeHost,
  setPrefs,
  getPrefs,
  getEffective,
  getEffectivePrefs,
  get,
  prefsSummary,
};