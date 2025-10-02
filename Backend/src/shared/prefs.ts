// src/shared/prefs.ts
// In-memory per-supplier preference store with safe defaults.
// Backward compatible with the previous version (legacy fields intact)
// and extended with structured fields + inboundOptIn.
//
// Exports kept for compatibility:
//  - type Tier, SizeBucket
//  - defaultPrefs(host)
//  - setPrefs(host, patch)
//  - getPrefs(host)
//  - prefsSummary(prefs)
//  - normalizeHost()
//  - __clearPrefs()

export type Tier = "A" | "B" | "C";
export type SizeBucket = "micro" | "small" | "mid" | "large";

// ---- Structured weights -----------------------------------------------------

export type SizeWeight = Record<SizeBucket, number>;
export type SignalWeight = {
  local: number;
  ecommerce: number;
  retail: number;
  wholesale: number;
};

export type Objectives = {
  price?: number;          // optional soft weights 0..10
  speed?: number;
  sustainability?: number;
  automation?: number;
  design?: number;
};

// ---- Raw (stored) prefs: keep legacy fields + allow structured --------------
export interface UserPrefs {
  host: string;                 // normalized key
  city?: string;
  radiusKm?: number;

  preferSmallMid?: boolean;
  sizeWeight?: Partial<Record<SizeBucket, number>>;
  tierFocus?: Tier[];

  // legacy tag buckets (kept)
  categoriesAllow?: string[];
  categoriesBlock?: string[];

  signalWeight?: Partial<SignalWeight>;

  maxWarm?: number;
  maxHot?: number;

  // NEW structured fields (optional in raw)
  titlesPreferred?: string[];
  materialsAllow?: string[];
  materialsBlock?: string[];
  certsRequired?: string[];
  excludeHosts?: string[];
  keywordsAdd?: string[];
  keywordsAvoid?: string[];
  objectives?: Objectives;

  // Marketplace opt-in
  inboundOptIn?: boolean;

  updatedAt?: string;
}

// ---- Effective prefs used by the rest of the app ---------------------------
export interface EffectivePrefs {
  host: string;
  city?: string;
  radiusKm: number;

  preferSmallMid: boolean;
  sizeWeight: SizeWeight;
  tierFocus: Tier[];

  // legacy (kept for scoring compatibility)
  categoriesAllow: string[];
  categoriesBlock: string[];

  signalWeight: SignalWeight;

  maxWarm: number;
  maxHot: number;

  // NEW structured
  titlesPreferred: string[];
  materialsAllow: string[];
  materialsBlock: string[];
  certsRequired: string[];
  excludeHosts: string[];
  keywordsAdd: string[];
  keywordsAvoid: string[];
  objectives?: Objectives;

  // Marketplace opt-in
  inboundOptIn: boolean;

  updatedAt: string;
}

// ---- Store ------------------------------------------------------------------
const STORE = new Map<string, UserPrefs>();

// ---- Helpers ----------------------------------------------------------------
export function normalizeHost(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function clamp(n: any, lo: number, hi: number, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

function uniqLower(a?: string[], limit = 400): string[] {
  const out = new Set<string>();
  for (const s of a || []) {
    const v = String(s || "").toLowerCase().trim();
    if (v) {
      out.add(v);
      if (out.size >= limit) break;
    }
  }
  return Array.from(out);
}

function nowIso() { return new Date().toISOString(); }

function mergeUniq(a?: string[], b?: string[], cap = 400): string[] {
  return uniqLower([...(a || []), ...(b || [])], cap);
}

function pickPrefixed(prefix: string, tags: string[]): string[] {
  const p = prefix.toLowerCase();
  const out: string[] = [];
  for (const t of tags) {
    const s = (t || "").toLowerCase();
    if (s.startsWith(p)) {
      const v = s.slice(p.length).trim();
      if (v) out.push(v);
    }
  }
  return uniqLower(out, 200);
}

// ---- Defaults ---------------------------------------------------------------
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

    // structured
    titlesPreferred: [],
    materialsAllow: [],
    materialsBlock: [],
    certsRequired: [],
    excludeHosts: [],
    keywordsAdd: [],
    keywordsAvoid: [],
    objectives: undefined,

    inboundOptIn: false,
    updatedAt: nowIso(),
  };
}

// ---- Raw -> Effective -------------------------------------------------------
function toEffective(u: UserPrefs): EffectivePrefs {
  const host = normalizeHost(u.host);
  const def = defaultPrefs(host);

  const sizeWeight: SizeWeight = {
    micro: clamp(u.sizeWeight?.micro ?? def.sizeWeight.micro, -3, 3, def.sizeWeight.micro),
    small: clamp(u.sizeWeight?.small ?? def.sizeWeight.small, -3, 3, def.sizeWeight.small),
    mid:   clamp(u.sizeWeight?.mid   ?? def.sizeWeight.mid,   -3, 3, def.sizeWeight.mid),
    large: clamp(u.sizeWeight?.large ?? def.sizeWeight.large, -3, 3, def.sizeWeight.large),
  };

  const signalWeight: SignalWeight = {
    local:     clamp(u.signalWeight?.local     ?? def.signalWeight.local,     -3, 3, def.signalWeight.local),
    ecommerce: clamp(u.signalWeight?.ecommerce ?? def.signalWeight.ecommerce, -1, 1, def.signalWeight.ecommerce),
    retail:    clamp(u.signalWeight?.retail    ?? def.signalWeight.retail,    -1, 1, def.signalWeight.retail),
    wholesale: clamp(u.signalWeight?.wholesale ?? def.signalWeight.wholesale, -1, 1, def.signalWeight.wholesale),
  };

  // Legacy arrays normalized
  const allow = uniqLower(u.categoriesAllow);
  const block = uniqLower(u.categoriesBlock);

  // Derive structured fields from any legacy prefixed tags
  const titlesFromTags = pickPrefixed("title:", allow);
  const matsAllowFromTags = pickPrefixed("mat:", allow);
  const matsBlockFromTags = pickPrefixed("mat:", block);
  const certsFromTags = pickPrefixed("cert:", allow);
  const kwAddFromTags = pickPrefixed("kw:", allow);
  const kwAvoidFromTags = pickPrefixed("kw:", block);
  const hostsBlockFromTags = pickPrefixed("host:", block);

  // Merge with any structured fields present in raw
  const titlesPreferred = mergeUniq(u.titlesPreferred, titlesFromTags, 200);
  const materialsAllow  = mergeUniq(u.materialsAllow,  matsAllowFromTags, 200);
  const materialsBlock  = mergeUniq(u.materialsBlock,  matsBlockFromTags, 200);
  const certsRequired   = mergeUniq(u.certsRequired,   certsFromTags, 200);
  const keywordsAdd     = mergeUniq(u.keywordsAdd,     kwAddFromTags, 200);
  const keywordsAvoid   = mergeUniq(u.keywordsAvoid,   kwAvoidFromTags, 200);
  const excludeHosts    = mergeUniq(u.excludeHosts,    hostsBlockFromTags, 200);

  return {
    host,
    city: u.city?.trim() || undefined,
    radiusKm: clamp(u.radiusKm, 1, 500, def.radiusKm),

    preferSmallMid: typeof u.preferSmallMid === "boolean" ? u.preferSmallMid : def.preferSmallMid,
    sizeWeight,
    tierFocus: (u.tierFocus && u.tierFocus.length) ? u.tierFocus : def.tierFocus,

    categoriesAllow: allow,
    categoriesBlock: block,

    signalWeight,

    maxWarm: clamp(u.maxWarm, 0, 50, def.maxWarm),
    maxHot:  clamp(u.maxHot,  0, 5,  def.maxHot),

    titlesPreferred,
    materialsAllow,
    materialsBlock,
    certsRequired,
    excludeHosts,
    keywordsAdd,
    keywordsAvoid,
    objectives: u.objectives ? { ...u.objectives } : undefined,

    inboundOptIn: Boolean(u.inboundOptIn),
    updatedAt: u.updatedAt || nowIso(),
  };
}

// ---- Public API -------------------------------------------------------------

export function getPrefs(hostLike: string): EffectivePrefs {
  const host = normalizeHost(hostLike);
  const raw = STORE.get(host);
  if (!raw) {
    const d = { host };
    STORE.set(host, d);
    return toEffective(d);
    // (We store minimal raw; effective fills defaults)
  }
  return toEffective(raw);
}

export function setPrefs(hostLike: string, patch: Partial<UserPrefs> & Partial<EffectivePrefs>): EffectivePrefs {
  const host = normalizeHost(hostLike);
  if (!host) throw new Error("bad_host");

  const existing: UserPrefs = STORE.get(host) || { host };

  // Merge shallowly; arrays normalized later in toEffective
  const merged: UserPrefs = {
    host,
    city: patch.city ?? existing.city,
    radiusKm: patch.radiusKm ?? existing.radiusKm,

    preferSmallMid: patch.preferSmallMid ?? existing.preferSmallMid,
    sizeWeight: {
      ...(existing.sizeWeight || {}),
      ...(patch.sizeWeight || {}),
    },
    tierFocus: (patch.tierFocus ?? existing.tierFocus) || undefined,

    categoriesAllow: mergeUniq(existing.categoriesAllow, patch.categoriesAllow, 400),
    categoriesBlock: mergeUniq(existing.categoriesBlock, patch.categoriesBlock, 400),

    signalWeight: {
      ...(existing.signalWeight || {}),
      ...(patch.signalWeight || {}),
    },

    maxWarm: patch.maxWarm ?? existing.maxWarm,
    maxHot:  patch.maxHot  ?? existing.maxHot,

    // structured arrays (merge; normalize in toEffective)
    titlesPreferred: mergeUniq(existing.titlesPreferred, patch.titlesPreferred, 200),
    materialsAllow:  mergeUniq(existing.materialsAllow,  patch.materialsAllow,  200),
    materialsBlock:  mergeUniq(existing.materialsBlock,  patch.materialsBlock,  200),
    certsRequired:   mergeUniq(existing.certsRequired,   patch.certsRequired,   200),
    excludeHosts:    mergeUniq(existing.excludeHosts,    patch.excludeHosts,    200),
    keywordsAdd:     mergeUniq(existing.keywordsAdd,     patch.keywordsAdd,     200),
    keywordsAvoid:   mergeUniq(existing.keywordsAvoid,   patch.keywordsAvoid,   200),

    objectives: {
      ...(existing.objectives || {}),
      ...(patch.objectives || {}),
    },

    inboundOptIn: typeof patch.inboundOptIn === "boolean"
      ? patch.inboundOptIn
      : existing.inboundOptIn,

    updatedAt: nowIso(),
  };

  STORE.set(host, merged);
  return toEffective(merged);
}

export function prefsSummary(p: EffectivePrefs): string {
  const parts: string[] = [];
  if (p.city) parts.push(`city=${p.city} (±${p.radiusKm}km)`);
  if (p.tierFocus.length) parts.push(`tier=[${p.tierFocus.join(",")}]`);
  parts.push(
    `sizeW(micro:${p.sizeWeight.micro}, small:${p.sizeWeight.small}, mid:${p.sizeWeight.mid}, large:${p.sizeWeight.large})`,
  );
  if (p.titlesPreferred.length) parts.push(`titles:${p.titlesPreferred.slice(0,3).join(",")}${p.titlesPreferred.length>3?"…":""}`);
  if (p.certsRequired.length) parts.push(`certs:${p.certsRequired.slice(0,2).join(",")}${p.certsRequired.length>2?"…":""}`);
  if (p.categoriesAllow.length) parts.push(`allow:${p.categoriesAllow.slice(0,5).join(",")}${p.categoriesAllow.length>5?"…":""}`);
  if (p.categoriesBlock.length) parts.push(`block:${p.categoriesBlock.slice(0,5).join(",")}${p.categoriesBlock.length>5?"…":""}`);
  parts.push(p.inboundOptIn ? "inbound:listed" : "inbound:off");
  return parts.join(" • ");
}

export function __clearPrefs() {
  STORE.clear();
}