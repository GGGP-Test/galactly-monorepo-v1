// src/ai/personalization.ts
/**
 * personalization.ts — per-user preference weights, presets, and scoring
 *
 * Combines signal bundles + company profile into a personalized lead score.
 * Supports presets ("Close Fast", "Stick Around", etc.) and online updates from feedback.
 */

import type { BundleResult } from "../leadgen/signals";
import type { CompanyProfile, Classification } from "./classify-extract";

// ----------------------------- Types -----------------------------

export type Weight = number; // 0..1 suggested (we normalize)
export type PresetId = "balanced" | "close_fast" | "stick_around" | "referral_friendly" | "price_sharp";

export interface ObjectiveWeights {
  speed: Weight;           // fast to first PO
  lifetime: Weight;        // retention / repeat potential
  goodwill: Weight;        // referrals, reviews, partnership vibes
  channelFit: Weight;      // reachable where user sells (email/social/ads)
  opsFit: Weight;          // operational match to packaging capabilities
  priceFit: Weight;        // proxy for price sensitivity/commodity risk
}

export interface Constraints {
  excludeEnterprise?: boolean;         // guardrail against very large companies
  allowedVerticals?: string[];         // limit to certain classifications
  geo?: { countries?: string[]; states?: string[] };
  sizeHintMax?: CompanyProfile["sizeHint"]; // cap by headcount band
}

export interface PersonalizationProfile {
  userId: string;
  weights: ObjectiveWeights;
  constraints?: Constraints;
  preset?: PresetId;
  createdAt: string;
  updatedAt: string;
  // historical online-learning crumbs (kept tiny)
  stats?: {
    seen: number;
    won: number;
    lost: number;
    avgTimeToClose?: number;  // days
    avgRevenue?: number;      // user-provided
  };
}

export interface FeedbackEvent {
  userId: string;
  leadId: string;
  outcome: "won" | "lost" | "ignored" | "disqualified";
  timeToCloseDays?: number;
  revenue?: number;
  satisfaction?: number; // 1..5
  referral?: boolean;
  reason?: string;       // optional free text
  ts?: string;
}

export interface PersonalizedScore {
  raw: number;           // 0..1
  normalized: number;    // 0..100 for UI
  breakdown: Record<keyof ObjectiveWeights, number>;  // each 0..1
  appliedPreset?: PresetId;
  rationale: string[];
}

// ----------------------------- Presets ---------------------------

export const PRESETS: Record<PresetId, ObjectiveWeights> = {
  balanced:       { speed: 0.25, lifetime: 0.25, goodwill: 0.15, channelFit: 0.15, opsFit: 0.15, priceFit: 0.05 },
  close_fast:     { speed: 0.45, lifetime: 0.15, goodwill: 0.05, channelFit: 0.2,  opsFit: 0.1,  priceFit: 0.05 },
  stick_around:   { speed: 0.15, lifetime: 0.45, goodwill: 0.2,  channelFit: 0.05, opsFit: 0.1,  priceFit: 0.05 },
  referral_friendly: { speed: 0.15, lifetime: 0.3, goodwill: 0.4, channelFit: 0.05, opsFit: 0.05, priceFit: 0.05 },
  price_sharp:    { speed: 0.25, lifetime: 0.2,  goodwill: 0.05, channelFit: 0.1,  opsFit: 0.1,  priceFit: 0.3 },
};

export function defaultProfile(userId: string, preset: PresetId = "balanced", constraints?: Constraints): PersonalizationProfile {
  return {
    userId,
    preset,
    weights: normalizeWeights(PRESETS[preset]),
    constraints,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stats: { seen: 0, won: 0, lost: 0 },
  };
}

export function applyPreset(p: PersonalizationProfile, preset: PresetId): PersonalizationProfile {
  p.preset = preset;
  p.weights = normalizeWeights(PRESETS[preset]);
  p.updatedAt = new Date().toISOString();
  return p;
}

// ----------------------------- Scoring ---------------------------

/**
 * Compute a personalized score from signals + profile (+ optional classification & company).
 * Inputs:
 *  - signals: output from signals runner
 *  - profile: user's preference weights/constraints
 *  - classification: optional taxonomy classification
 *  - company: optional extracted profile (for contactability & size)
 */
export function scoreLead(
  signals: BundleResult,
  profile: PersonalizationProfile,
  classification?: Classification,
  company?: CompanyProfile
): PersonalizedScore {
  // Pull individual signal scores with safe defaults
  const s = (id: string) => signals.byId?.[id]?.score ?? 0;
  const commerce = s("commerce");
  const b2b = s("b2b_intent");
  const ops = s("ops");
  const reviews = s("reviews");
  const hiring = s("hiring");
  const ads = s("ads");

  // Derived subscores 0..1
  const contactability = contactabilityScore(company);
  const channel = clamp01(0.6 * ads + 0.4 * socialPresence(company));
  const speed = clamp01(0.45 * b2b + 0.25 * commerce + 0.15 * ads + 0.15 * contactability);
  const lifetime = clamp01(0.4 * reviews + 0.25 * ops + 0.2 * hiring + 0.15 * channel);
  const goodwill = clamp01(0.55 * reviews + 0.25 * socialPresence(company) + 0.2 * communitySignals(company));
  const opsFit = clamp01(0.6 * ops + 0.3 * b2b + 0.1 * commerce);
  const priceFit = priceSensitivityProxy(classification, company); // commodity vs branded proxy

  const breakdown: Record<keyof ObjectiveWeights, number> = {
    speed,
    lifetime,
    goodwill,
    channelFit: channel,
    opsFit,
    priceFit,
  };

  // Constraint penalties
  let penalty = 0;
  const rationale: string[] = [];

  if (profile.constraints?.excludeEnterprise) {
    if (isEnterprise(company)) { penalty += 0.2; rationale.push("Excluded: enterprise size"); }
  }
  if (profile.constraints?.sizeHintMax && exceedsSizeHint(company, profile.constraints.sizeHintMax)) {
    penalty += 0.15; rationale.push(`Above size cap (${profile.constraints.sizeHintMax})`);
  }
  if (profile.constraints?.allowedVerticals && classification) {
    if (!profile.constraints.allowedVerticals.includes(classification.label)) {
      penalty += 0.25; rationale.push(`Outside allowed verticals`);
    }
  }
  if (profile.constraints?.geo && company?.locations?.length) {
    const match = geoMatches(company.locations, profile.constraints.geo);
    if (!match) { penalty += 0.1; rationale.push("Out of preferred geo"); }
  }

  // Weighted sum
  const weights = normalizeWeights(profile.weights);
  const raw =
    weights.speed      * speed +
    weights.lifetime   * lifetime +
    weights.goodwill   * goodwill +
    weights.channelFit * channel +
    weights.opsFit     * opsFit +
    weights.priceFit   * priceFit;

  const rawAfterPenalty = clamp01(raw * (1 - penalty));
  const normalized = Math.round(rawAfterPenalty * 100);

  // add helpful rationals
  maybePush(rationale, speed > 0.7, "Fast-close signals high");
  maybePush(rationale, lifetime > 0.7, "Retention signals strong");
  maybePush(rationale, goodwill > 0.7, "Goodwill/referral friendly");
  maybePush(rationale, channel > 0.7, "Reachable on preferred channels");
  maybePush(rationale, opsFit > 0.7, "Operationally aligned");
  maybePush(rationale, priceFit > 0.7, "Price-leverage likely");

  return {
    raw: rawAfterPenalty,
    normalized,
    breakdown,
    appliedPreset: profile.preset,
    rationale,
  };
}

// ------------------------- Online Updates ------------------------

/**
 * Lightweight bandit-style update:
 *  - won: nudges up weights that were high at time of decision (reinforce path)
 *  - lost/disqualified: nudge down dominating weight slightly
 *  - satisfaction/referral: boosts goodwill/lifetime
 */
export function applyFeedback(p: PersonalizationProfile, f: FeedbackEvent): PersonalizationProfile {
  if (p.userId !== f.userId) return p;
  const lr = 0.06; // learning rate
  const w = { ...p.weights };

  const inc = (k: keyof ObjectiveWeights, delta: number) => { w[k] = clamp01(w[k] + delta); };

  if (f.outcome === "won") {
    inc("speed", 0.02);
    inc("lifetime", (f.timeToCloseDays && f.timeToCloseDays > 30) ? 0.02 : 0.01);
    if ((f.satisfaction ?? 0) >= 4) inc("goodwill", 0.03);
    if (f.referral) inc("goodwill", 0.04);
    // if quick close, reinforce speed; if high revenue, reinforce opsFit/priceFit
    if ((f.timeToCloseDays ?? 999) <= 14) inc("speed", 0.03);
    if ((f.revenue ?? 0) > 20000) { inc("opsFit", 0.02); inc("priceFit", 0.02); }
  } else if (f.outcome === "lost") {
    // softly shift away from speed-first bias (common overfit)
    inc("speed", -lr * 0.8);
    inc("priceFit", +lr * 0.5); // losses often price-related
    inc("lifetime", +lr * 0.3);
  } else if (f.outcome === "disqualified") {
    // tighten ops/constraints emphasis
    inc("opsFit", +lr * 0.8);
    inc("speed", -lr * 0.4);
  }

  p.weights = normalizeWeights(w);
  // stats
  const s = p.stats || { seen: 0, won: 0, lost: 0 };
  s.seen += 1;
  if (f.outcome === "won") s.won += 1;
  if (f.outcome === "lost") s.lost += 1;
  if (f.timeToCloseDays) {
    const total = (p.stats?.avgTimeToClose ?? f.timeToCloseDays);
    s.avgTimeToClose = Math.round((total * (s.seen - 1) + f.timeToCloseDays) / s.seen);
  }
  if (f.revenue) {
    const total = (p.stats?.avgRevenue ?? f.revenue);
    s.avgRevenue = Math.round((total * (s.seen - 1) + f.revenue) / s.seen);
  }
  p.stats = s;
  p.updatedAt = new Date().toISOString();
  return p;
}

// -------------------------- UI Schema ----------------------------

export interface SliderDef {
  key: keyof ObjectiveWeights;
  label: string;
  help?: string;
  min: number;
  max: number;
  step: number;
}

export function uiSliders(): SliderDef[] {
  return [
    { key: "speed",      label: "Close speed",         help: "Bias towards buyers likely to place a PO quickly.", min: 0, max: 1, step: 0.05 },
    { key: "lifetime",   label: "Stickiness",          help: "Favor retention/subscription/refill potential.",    min: 0, max: 1, step: 0.05 },
    { key: "goodwill",   label: "Goodwill & referrals",help: "Reviews, brand love, referral likelihood.",         min: 0, max: 1, step: 0.05 },
    { key: "channelFit", label: "Channel reach",       help: "Are they reachable where you operate?",            min: 0, max: 1, step: 0.05 },
    { key: "opsFit",     label: "Ops fit",             help: "Operational match to your packaging capabilities.", min: 0, max: 1, step: 0.05 },
    { key: "priceFit",   label: "Price leverage",      help: "Commodity/price sensitivity vs premium.",           min: 0, max: 1, step: 0.05 },
  ];
}

export function validateWeights(w: Partial<ObjectiveWeights>): ObjectiveWeights {
  const merged = { ...PRESETS.balanced, ...w };
  return normalizeWeights(merged);
}

// -------------------------- Helpers ------------------------------

function normalizeWeights(w: ObjectiveWeights): ObjectiveWeights {
  const sum = w.speed + w.lifetime + w.goodwill + w.channelFit + w.opsFit + w.priceFit;
  if (sum <= 0) return PRESETS.balanced;
  const scale = 1 / sum;
  return {
    speed:      clamp01(w.speed * scale),
    lifetime:   clamp01(w.lifetime * scale),
    goodwill:   clamp01(w.goodwill * scale),
    channelFit: clamp01(w.channelFit * scale),
    opsFit:     clamp01(w.opsFit * scale),
    priceFit:   clamp01(w.priceFit * scale),
  };
}

function clamp01(n: number) { return Math.min(1, Math.max(0, n)); }

function maybePush(arr: string[], cond: any, s: string) { if (cond) arr.push(s); }

function isEnterprise(company?: CompanyProfile): boolean {
  const h = company?.sizeHint;
  return h === "501-1000" || h === "1000+";
}

function exceedsSizeHint(company: CompanyProfile | undefined, max: NonNullable<Constraints["sizeHintMax"]>): boolean {
  const order: CompanyProfile["sizeHint"][] = ["solo","1-10","11-50","51-200","201-500","501-1000","1000+"];
  if (!company?.sizeHint) return false;
  const idx = order.indexOf(company.sizeHint);
  const cap = order.indexOf(max);
  return idx > cap;
}

function geoMatches(locations: string[], pref: NonNullable<Constraints["geo"]>): boolean {
  const hay = locations.join(" | ");
  const hasCountry = !pref.countries?.length || (pref.countries!.some(c => new RegExp(`\\b${escapeReg(c)}\\b`, "i").test(hay)));
  const hasState = !pref.states?.length || (pref.states!.some(s => new RegExp(`\\b${escapeReg(s)}\\b`, "i").test(hay)));
  return hasCountry && hasState;
}

function escapeReg(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function socialPresence(company?: CompanyProfile): number {
  if (!company?.socials) return 0;
  const n = Object.keys(company.socials).length;
  return n >= 5 ? 1 : n / 5;
}

function communitySignals(company?: CompanyProfile): number {
  // crude proxy: emails present + social presence
  const e = (company?.emails?.length ?? 0) > 0 ? 0.4 : 0;
  return clamp01(e + 0.6 * socialPresence(company));
}

function contactabilityScore(company?: CompanyProfile): number {
  const e = Math.min(1, (company?.emails?.length ?? 0) / 3);
  const p = Math.min(1, (company?.phones?.length ?? 0) / 2);
  return clamp01(0.6 * e + 0.4 * p);
}

function priceSensitivityProxy(_classification?: Classification, company?: CompanyProfile): number {
  // If brand has heavy reviews & strong social, likely premium (less price sensitive) -> lower leverage.
  // If little brand presence but high B2B ops, likely commodity -> higher leverage.
  // With limited inputs here, use social presence inverse of leverage.
  const brand = socialPresence(company);
  const reviewsHint = /5.?star|rating|review/i.test(company?.description || "") ? 0.3 : 0;
  const brandStrength = clamp01(0.7 * brand + reviewsHint);
  const leverage = clamp01(1 - brandStrength); // more leverage when brand is weak
  return leverage;
}

// ---------------------- Persistence Glue (optional) --------------

/**
 * Storage interface (to be wired to your DB/kv). You can swap with your existing learning-store.
 */
export interface PersonalizationStore {
  get(userId: string): Promise<PersonalizationProfile | null>;
  set(profile: PersonalizationProfile): Promise<void>;
}

export async function loadOrCreate(store: PersonalizationStore, userId: string, preset: PresetId = "balanced", constraints?: Constraints) {
  const ex = await store.get(userId);
  if (ex) return ex;
  const p = defaultProfile(userId, preset, constraints);
  await store.set(p);
  return p;
}

export async function recordFeedback(store: PersonalizationStore, feedback: FeedbackEvent): Promise<PersonalizationProfile | null> {
  const p = await store.get(feedback.userId);
  if (!p) return null;
  const updated = applyFeedback(p, feedback);
  await store.set(updated);
  return updated;
}
