// src/ai/logic/rules.ts

/**
 * Rules Engine (Lead Intelligence)
 * --------------------------------
 * Declarative scoring/classification/routing.
 *
 * Core API:
 *   scoreLead(features, { plan, explain: true })
 *
 * Concepts:
 *  - Conditions tree (all/any/none + ops) against a flat/JSON feature object
 *  - Actions: score +=/-, set tier, add tags/reasons, pick channels, block
 *  - Packs: bundles of rules; you can enable/disable packs per plan
 */

import { getVariant, isEnabled } from "../core/feature-flags";

type Num = number;

export interface LeadFeatures {
  // identity
  company?: { name?: string; domain?: string; country?: string; employeeCount?: number; revenue?: number };
  // demand signals
  ads?: { running?: boolean; channels?: string[]; spendTier?: "low" | "mid" | "high" };
  jobs?: { roles?: string[]; count?: number };
  tech?: { ecommerce?: boolean; cms?: string; cdn?: string; analytics?: string[] };
  content?: { blog?: boolean; recentPosts?: number; rfqMentions?: number };
  pages?: { hasPackagingPage?: boolean; hasShippingPolicy?: boolean; hasSustainability?: boolean };
  social?: { followers?: number; engagement?: "low" | "mid" | "high" };
  reviews?: { avg?: number; count?: number; volatility?: "low" | "mid" | "high" };
  // fit
  productFit?: { materials?: string[]; formats?: string[]; volumes?: "small" | "mid" | "large" };
  // procurement
  suppliers?: { known?: string[]; likelyPriceBand?: "low" | "mid" | "high" };
  // ops
  logistics?: { warehouses?: number; 3pl?: boolean; regions?: string[] };
  // temporal
  seasonality?: { inSeason?: boolean; weeksToPeak?: number };
  // compliance
  risky?: { doNotContact?: boolean; blockedCountry?: boolean };
  // freeform
  extra?: Record<string, any>;
}

export interface ScoreOptions {
  plan?: "free" | "pro" | "scale";
  explain?: boolean;
}

export interface Scorecard {
  score: Num;              // 0..100
  tier: "hot" | "warm" | "skip";
  channelHints: string[];  // e.g. ["email", "linkedin", "phone"]
  tags: string[];          // e.g. ["ecom", "sustainability", "rfq"]
  reasons: string[];       // human-readable why
  blocked?: boolean;
}

type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "contains" | "exists" | "regex" | "startsWith" | "endsWith";
export interface Condition {
  all?: Condition[];
  any?: Condition[];
  none?: Condition[];
  op?: Op;
  path?: string; // dotted path in features
  value?: any;
}

export interface Action {
  add?: number;         // score +=
  sub?: number;         // score -=
  mul?: number;         // score *=
  setTier?: "hot" | "warm" | "skip";
  tag?: string[];
  reason?: string[];
  channel?: string[];   // add channel hints
  block?: boolean;
}

export interface Rule {
  id?: string;
  when?: Condition;
  then: Action;
  ifNot?: Action; // optional else branch (lightweight)
  weight?: number; // multiply add/sub effect
}

export interface RulePack {
  key: string;
  description?: string;
  enabled?: boolean;
  rules: Rule[];
}

function getPath(obj: any, path?: string) {
  if (!path) return undefined;
  return path.split(".").reduce((acc: any, k) => (acc == null ? undefined : acc[k]), obj);
}

function test(cond: Condition | undefined, obj: any): boolean {
  if (!cond) return true;
  if (cond.all) return cond.all.every((c) => test(c, obj));
  if (cond.any) return cond.any.some((c) => test(c, obj));
  if (cond.none) return cond.none.every((c) => !test(c, obj));

  const lhs = getPath(obj, cond.path);
  const rhs = cond.value;

  switch (cond.op) {
    case "exists": return lhs !== undefined && lhs !== null;
    case "eq": return lhs === rhs;
    case "neq": return lhs !== rhs;
    case "gt": return Number(lhs) > Number(rhs);
    case "gte": return Number(lhs) >= Number(rhs);
    case "lt": return Number(lhs) < Number(rhs);
    case "lte": return Number(lhs) <= Number(rhs);
    case "in": return Array.isArray(rhs) && rhs.includes(lhs);
    case "nin": return Array.isArray(rhs) && !rhs.includes(lhs);
    case "contains":
      if (Array.isArray(lhs)) return lhs.includes(rhs);
      if (typeof lhs === "string") return lhs.toLowerCase().includes(String(rhs).toLowerCase());
      return false;
    case "regex":
      try { return new RegExp(rhs).test(String(lhs ?? "")); } catch { return false; }
    case "startsWith": return typeof lhs === "string" && String(lhs).toLowerCase().startsWith(String(rhs).toLowerCase());
    case "endsWith": return typeof lhs === "string" && String(lhs).toLowerCase().endsWith(String(rhs).toLowerCase());
    default: return false;
  }
}

function applyAction(score: number, acc: Scorecard, action?: Action, weight = 1) {
  if (!action) return score;
  if (action.add) score += (action.add * weight);
  if (action.sub) score -= (action.sub * weight);
  if (action.mul) score *= action.mul;
  if (action.setTier) acc.tier = action.setTier;
  if (action.tag?.length) acc.tags.push(...action.tag);
  if (action.reason?.length) acc.reasons.push(...action.reason);
  if (action.channel?.length) acc.channelHints.push(...action.channel);
  if (action.block) acc.blocked = true;
  return score;
}

// ---------------- Default Rule Packs ----------------

const baseScoring: RulePack = {
  key: "base",
  description: "Demand + Fit + Procurement + Ops + Social + Reviews",
  enabled: true,
  rules: [
    // Demand: Ads running
    { when: { path: "ads.running", op: "eq", value: true }, then: { add: 18, tag: ["ads"], reason: ["Running ads"] } },
    { when: { path: "ads.spendTier", op: "in", value: ["mid", "high"] }, then: { add: 8, reason: ["Ad spend signal"] } },

    // Jobs: hiring ops/packaging/purchasing
    { when: { path: "jobs.count", op: "gte", value: 2 }, then: { add: 8, tag: ["hiring"], reason: ["Hiring growth"] } },
    { when: { path: "jobs.roles", op: "contains", value: "procurement" }, then: { add: 12, reason: ["Procurement roles open"] } },
    { when: { path: "jobs.roles", op: "contains", value: "packaging" }, then: { add: 12, reason: ["Packaging roles open"] } },

    // Content RFQ mentions
    { when: { path: "content.rfqMentions", op: "gte", value: 1 }, then: { add: 20, tag: ["rfq"], reason: ["RFQ/quote intent"] } },

    // Pages that correlate to packaging ops maturity
    { when: { path: "pages.hasPackagingPage", op: "eq", value: true }, then: { add: 10, tag: ["packaging-page"] } },
    { when: { path: "pages.hasShippingPolicy", op: "eq", value: true }, then: { add: 6 } },
    { when: { path: "pages.hasSustainability", op: "eq", value: true }, then: { add: 5, tag: ["sustainability"] } },

    // Tech stack fit: ecommerce
    { when: { path: "tech.ecommerce", op: "eq", value: true }, then: { add: 10, tag: ["ecom"], reason: ["Ecom stack present"] } },

    // Product Fit: preferred materials/formats
    { when: { path: "productFit.materials", op: "contains", value: "stretch wrap" }, then: { add: 14, tag: ["stretchwrap"] } },
    { when: { path: "productFit.formats", op: "contains", value: "corrugated" }, then: { add: 8, tag: ["corrugated"] } },

    // Suppliers (competitor pressure / price opportunity)
    { when: { path: "suppliers.known", op: "contains", value: "uline" }, then: { add: 12, reason: ["Competing with Uline"] } },
    { when: { path: "suppliers.likelyPriceBand", op: "eq", value: "high" }, then: { add: 10, reason: ["High price band"] } },

    // Ops
    { when: { path: "logistics.warehouses", op: "gte", value: 2 }, then: { add: 7 } },
    { when: { path: "logistics.3pl", op: "eq", value: true }, then: { add: 5 } },

    // Social & Reviews (quality & goodwill proxy)
    { when: { path: "social.engagement", op: "eq", value: "high" }, then: { add: 6, tag: ["active-social"] } },
    { when: { path: "reviews.avg", op: "gte", value: 4.3 }, then: { add: 6, tag: ["goodwill"] } },

    // Seasonality
    { when: { path: "seasonality.inSeason", op: "eq", value: true }, then: { add: 6, reason: ["In-season demand"] } },
  ],
};

const riskFilters: RulePack = {
  key: "risk",
  description: "Compliance and safety filters",
  enabled: true,
  rules: [
    { when: { path: "risky.doNotContact", op: "eq", value: true }, then: { block: true, sub: 100, setTier: "skip", reason: ["DNC"] } },
    { when: { path: "risky.blockedCountry", op: "eq", value: true }, then: { block: true, sub: 100, setTier: "skip", reason: ["Blocked GEO"] } },
  ],
};

const channelRouting: RulePack = {
  key: "routing",
  description: "Best-first outreach channel suggestions",
  enabled: true,
  rules: [
    { when: { path: "tech.ecommerce", op: "eq", value: true }, then: { channel: ["email", "linkedin"], reason: ["Ecom: email+LI"] } },
    { when: { path: "content.rfqMentions", op: "gte", value: 1 }, then: { channel: ["email", "phone"], reason: ["RFQ: email+call"] } },
    { when: { path: "social.engagement", op: "eq", value: "high" }, then: { channel: ["linkedin"], reason: ["Active on LI"] } },
  ],
};

const classification: RulePack = {
  key: "classify",
  description: "Map score to tier",
  enabled: true,
  rules: [
    { when: { path: "extra.rawScore", op: "gte", value: 70 }, then: { setTier: "hot" } },
    { when: { path: "extra.rawScore", op: "lt", value: 70 }, then: { setTier: "warm" } },
    { when: { path: "extra.rawScore", op: "lt", value: 40 }, then: { setTier: "skip" } },
  ],
};

// ---------------- Scoring ----------------

export function scoreLead(features: LeadFeatures, opts: ScoreOptions = {}): Scorecard {
  const packs: RulePack[] = [];

  // Toggle packs by flags/plans if needed
  packs.push(baseScoring);
  packs.push(riskFilters);
  packs.push(channelRouting);
  packs.push(classification);

  // seed
  let score = 10; // base prior
  const out: Scorecard = { score, tier: "warm", channelHints: [], tags: [], reasons: [] };

  // execute rules
  for (const pack of packs) {
    if (!pack.enabled) continue;
    for (const rule of pack.rules) {
      const ok = test(rule.when, features);
      if (ok) {
        score = applyAction(score, out, rule.then, rule.weight ?? 1);
      } else if (rule.ifNot) {
        score = applyAction(score, out, rule.ifNot, rule.weight ?? 1);
      }
    }
  }

  // clamp and finalize tier with plan-aware thresholds
  const hotCut = getVariant<number>("router.threshold.hot", { plan: opts.plan }) ?? 70;
  const skipCut = getVariant<number>("router.threshold.skip", { plan: opts.plan }) ?? 40;

  if (score >= hotCut) out.tier = "hot";
  else if (score < skipCut) out.tier = "skip";
  else out.tier = "warm";

  // dedupe arrays
  out.channelHints = Array.from(new Set(out.channelHints));
  out.tags = Array.from(new Set(out.tags));
  out.reasons = Array.from(new Set(out.reasons));
  out.score = Math.max(0, Math.min(100, Math.round(score)));

  // UI explanations gate
  if (!isEnabled("ui.debug.explanations", { plan: opts.plan })) out.reasons = [];

  return out;
}

// Convenience: compose from partial signals
export function quickScore(partial: Partial<LeadFeatures>, plan: ScoreOptions["plan"] = "free") {
  return scoreLead(partial as LeadFeatures, { plan, explain: true });
}

// Example default thresholds (override with env or remote config):
// FLAG__router__threshold__hot=72
// FLAG__router__threshold__skip=38
