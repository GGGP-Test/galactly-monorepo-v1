// src/ai/router/lead-router.ts

/**
 * LeadRouter
 *  - Scores leads using ExtractedSignals and user playbook weights
 *  - Classifies as "hot" / "warm" / "skip"
 *  - Suggests outreach channels (integrates with ChannelBandit if available)
 */

import type {
  LeadCandidate,
  ScoringWeights,
  PlaybookPreset,
  UserDiscoveryInput,
  Plan,
} from "../crawl/types";
import { DEFAULT_PLAYBOOKS } from "./presets"; // optional preset map; fallback below if file missing

// Optional import (if present). Fallback to internal ranking if not.
let ChannelBandit: any = undefined;
let typeChannel: any = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../outreach/channel-bandit");
  ChannelBandit = mod.ChannelBandit;
  typeChannel = mod.Channel as any;
} catch {
  // no-op; fallback logic below
}

// ---------------- Types ----------------

export type LeadTier = "hot" | "warm" | "skip";

export interface LeadRouteDecision {
  tier: LeadTier;
  score: number; // 0..100
  match: number; // 0..1 product/category match
  reasons: string[];
  preferredChannels: string[];
  nextActions: string[];
}

// ---------------- Router ----------------

export class LeadRouter {
  private weightsFor(preset?: PlaybookPreset): ScoringWeights {
    const fallback: Record<PlaybookPreset["id"], ScoringWeights> = {
      balanced: { demand: 0.25, procurement: 0.2, ops: 0.2, reputation: 0.2, urgency: 0.15 },
      "fast-close": { demand: 0.35, procurement: 0.25, ops: 0.15, reputation: 0.1, urgency: 0.15 },
      lifetime: { demand: 0.2, procurement: 0.2, ops: 0.2, reputation: 0.3, urgency: 0.1 },
      goodwill: { demand: 0.15, procurement: 0.15, ops: 0.15, reputation: 0.45, urgency: 0.1 },
      custom: { demand: 0.25, procurement: 0.2, ops: 0.2, reputation: 0.2, urgency: 0.15 },
    };
    const table = (DEFAULT_PLAYBOOKS ?? fallback) as typeof fallback;
    return table[(preset?.id ?? "balanced") as keyof typeof table];
  }

  route(lead: LeadCandidate, user: UserDiscoveryInput, plan: Plan): LeadRouteDecision {
    const weights = this.weightsFor(user.playbook);
    const match = this.calcMatch(lead, user);
    const score = this.calcScore(lead, weights, match);

    const reasons: string[] = [];
    if ((lead.signals.rfqPhrases?.length ?? 0) > 0) reasons.push("RFQ/wholesale intent detected");
    if (lead.signals.hasCart) reasons.push("Active e-commerce (cart/checkout present)");
    if ((lead.signals.reviewHints?.length ?? 0) > 0) reasons.push("Public reviews or ratings found");
    if ((lead.signals.platformHints?.length ?? 0) > 0) reasons.push(`Platform: ${lead.signals.platformHints.join(", ")}`);
    if ((lead.signals.suppliersMentions?.length ?? 0) > 0) reasons.push("Mentions of supplier brands");

    const tier = this.classify(score, match, lead);
    const preferredChannels = this.rankChannels(lead, plan).slice(0, 3);
    const nextActions = this.suggestNextActions(lead, tier, preferredChannels);

    return { tier, score, match, reasons, preferredChannels, nextActions };
  }

  // ------------- Scoring -------------

  private calcScore(lead: LeadCandidate, w: ScoringWeights, match: number): number {
    // Normalize provided weights
    const sum = w.demand + w.procurement + w.ops + w.reputation + w.urgency || 1;
    const W = {
      demand: w.demand / sum,
      procurement: w.procurement / sum,
      ops: w.ops / sum,
      reputation: w.reputation / sum,
      urgency: w.urgency / sum,
    };

    const s = lead.signals;
    const core =
      (s.demand ?? 0) * W.demand +
      (s.procurement ?? 0) * W.procurement +
      (s.ops ?? 0) * W.ops +
      (s.reputation ?? 0) * W.reputation +
      (s.urgency ?? 0) * W.urgency;

    // Product-market fit multiplier: 0.7—1.15 band
    const pmfBoost = 0.7 + 0.45 * clamp01(match);
    // RFQ and cart small bump
    const intentBump = clamp01(((s.rfqPhrases?.length ?? 0) > 0 ? 0.07 : 0) + (s.hasCart ? 0.05 : 0));

    const final0to1 = clamp01(core * pmfBoost + intentBump);
    return Math.round(final0to1 * 100);
  }

  private classify(score: number, match: number, lead: LeadCandidate): LeadTier {
    const s = lead.signals;
    const strongIntent = (s.rfqPhrases?.length ?? 0) > 0 || !!s.hasCart;
    const highOps = (s.ops ?? 0) >= 0.55;

    if (score >= 80 && match >= 0.75 && strongIntent) return "hot";
    if (score >= 65 && match >= 0.55) return "hot";
    if (score >= 55 && match >= 0.4) return "warm";
    if (score >= 50 && highOps) return "warm";
    return "skip";
  }

  // ------------- Matching -------------

  private calcMatch(lead: LeadCandidate, user: UserDiscoveryInput): number {
    const focuses = normalizeSet(user.focuses ?? []);
    if (!focuses.size) return 0.5; // neutral if user didn't specify

    const leadKeywords = normalizeSet(lead.signals.packagingKeywords ?? []);
    // Synonym expand both sides
    const expandedFocuses = expandSyns(focuses);
    const expandedLead = expandSyns(leadKeywords);

    const inter = intersection(expandedFocuses, expandedLead).size;
    const union = new Set([...expandedFocuses, ...expandedLead]).size || 1;
    return inter / union;
  }

  // ------------- Channel ranking -------------

  private rankChannels(lead: LeadCandidate, plan: Plan): string[] {
    // If ChannelBandit exists, use it
    if (ChannelBandit) {
      const bandit = new ChannelBandit();
      const hints = {
        hasCart: !!lead.signals.hasCart,
        platform: lead.signals.platformHints?.[0],
        hasPhones: (lead.signals.phones?.length ?? 0) > 0,
        hasEmails: (lead.signals.emails?.length ?? 0) > 0,
        rfq: (lead.signals.rfqPhrases?.length ?? 0) > 0,
      };
      const ranked = bandit.rank(hints);
      return ranked;
    }

    // Fallback heuristic: prefer direct channels present on site
    const out: string[] = [];
    if ((lead.signals.emails?.length ?? 0) > 0) out.push("email");
    if ((lead.signals.phones?.length ?? 0) > 0) out.push("phone");
    if (lead.signals.hasCart) out.push("storefront");
    if ((lead.signals.rfqPhrases?.length ?? 0) > 0) out.push("contact_form");
    if ((lead.signals.platformHints ?? []).some((p) => /Shopify|WooCommerce|Magento/.test(p))) out.push("app_inbox");
    // Ensure uniqueness
    return Array.from(new Set(out.length ? out : ["contact_form", "email", "linkedin"]));
  }

  private suggestNextActions(lead: LeadCandidate, tier: LeadTier, channels: string[]): string[] {
    const actions: string[] = [];
    const name = lead.company ?? lead.website;

    if (tier === "hot") {
      actions.push(`Prioritize outreach to ${name} via ${channels[0]}.`);
      if (lead.signals.hasCart) actions.push("Add product fit bundle to pitch (based on detected catalog keywords).");
      if ((lead.signals.reviewHints?.length ?? 0) > 0) actions.push("Reference recent reviews/social proof in opener.");
      if ((lead.signals.suppliersMentions?.length ?? 0) > 0) actions.push("Position as alternative to their mentioned supplier.");
    } else if (tier === "warm") {
      actions.push(`Queue nurturing sequence to ${name} across ${channels.slice(0, 2).join(" + ")}.`);
      if ((lead.signals.careersLinks?.length ?? 0) > 0) actions.push("Mention hiring/scale signals to align on ops timing.");
      actions.push("Offer sample pack or pilot MOQ to accelerate intent.");
    } else {
      actions.push("Defer; monitor for new intent triggers (RFQ, blog updates, ops changes).");
    }
    return actions;
  }
}

// ---------------- Helpers ----------------

function normalizeSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const item of list) {
    const t = (item || "").toLowerCase().trim();
    if (!t) continue;
    out.add(t.replace(/\s+/g, " "));
  }
  return out;
}

function expandSyns(set: Set<string>): Set<string> {
  const out = new Set<string>(set);
  for (const item of set) {
    const syns = SYNONYMS[item];
    if (syns) for (const s of syns) out.add(s);
  }
  return out;
}

function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// ---------------- Synonyms ----------------

const SYNONYMS: Record<string, string[]> = {
  "stretch wrap": ["pallet wrap", "pallet film", "stretch film"],
  "pallet wrap": ["stretch wrap", "stretch film"],
  "shrink wrap": ["shrink film"],
  "custom boxes": ["printed boxes", "branded boxes", "corrugated boxes"],
  corrugated: ["corrugated boxes", "boxes"],
  "void fill": ["packing peanuts", "air pillows", "inflatable void fill", "kraft paper", "packing paper"],
  tape: ["water-activated tape", "filament tape", "strapping tape"],
  "poly mailers": ["mailers"],
  labels: ["shipping labels", "thermal labels"],
};
