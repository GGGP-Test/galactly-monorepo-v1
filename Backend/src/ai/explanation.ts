// src/ai/explanation.ts
/**
 * explanation.ts — builds human-readable, UI-ready explanations for why a lead is
 * warm/hot, what signals drove the score, risks, and suggested next actions.
 *
 * Works with:
 *  - signals.ts (BundleResult)
 *  - classify-extract.ts (Classification, CompanyProfile)
 *  - personalization.ts (PersonalizedScore)
 */

import type { BundleResult, SignalDatum } from "../leadgen/signals";
import type { Classification, CompanyProfile } from "./classify-extract";
import type { PersonalizedScore } from "./personalization";

export type Verbosity = "tiny" | "short" | "normal" | "detailed";

export interface ExplainOptions {
  verbosity?: Verbosity;
  audience?: "user" | "internal";
  includeLineage?: boolean; // include data source hints
  includeNextSteps?: boolean;
  locale?: string; // reserved for future i18n
}

export interface Explanation {
  headline: string;
  score: number;         // 0..100
  tier: "hot" | "warm";
  summary: string;
  bullets: string[];
  risks: string[];
  next?: string[];
  lineage?: Array<{ id: string; label: string; providers?: string[]; evidence?: string }>;
}

/**
 * Main entry: craft an explanation object.
 */
export function explainLead(
  company: CompanyProfile,
  classification: Classification | undefined,
  signals: BundleResult,
  score: PersonalizedScore,
  opts: ExplainOptions = {}
): Explanation {
  const v = opts.verbosity ?? "normal";
  const tier = score.normalized >= 75 ? "hot" : "warm";

  const headline = makeHeadline(company, classification, score, tier);
  const summary = makeSummary(company, classification, score, v);
  const bullets = makeBullets(signals, score, v);
  const risks = makeRisks(signals, company, classification, v);
  const next = opts.includeNextSteps ? makeNextSteps(signals, company) : undefined;
  const lineage = opts.includeLineage ? makeLineage(signals) : undefined;

  return {
    headline,
    score: score.normalized,
    tier,
    summary,
    bullets,
    risks,
    next,
    lineage,
  };
}

// ------------------------ sections builders ----------------------

function makeHeadline(company: CompanyProfile, cls: Classification | undefined, score: PersonalizedScore, tier: "hot" | "warm") {
  const name = company.name || company.domain;
  const vLabel = cls?.label?.replace(/_/g, " ") || "unclassified";
  return `${name}: ${tier.toUpperCase()} lead (${score.normalized}/100) — ${vLabel}`;
}

function makeSummary(company: CompanyProfile, cls: Classification | undefined, score: PersonalizedScore, v: Verbosity): string {
  const parts: string[] = [];
  parts.push(`Projected fit is ${tierWord(score.normalized)} with ${score.normalized}/100.`);
  if (cls) parts.push(`Vertical: ${cls.label.replace(/_/g, " ")} (${pct(cls.confidence)} confidence).`);
  if (company.sizeHint) parts.push(`Size: ${company.sizeHint}.`);
  if (company.locations?.length) parts.push(`Location signals: ${company.locations.slice(0, 3).join(", ")}${company.locations.length > 3 ? "…" : ""}.`);

  if (v === "tiny") return parts.join(" ");
  if (v === "short") return parts.join(" ");
  // normal/detailed
  const socialN = Object.keys(company.socials || {}).length;
  const contactBits = [
    (company.emails?.length ?? 0) > 0 ? "emails present" : "",
    (company.phones?.length ?? 0) > 0 ? "phones present" : "",
    socialN ? `${socialN} social profiles` : "",
  ].filter(Boolean);
  if (contactBits.length) parts.push(`Contactability: ${contactBits.join(", ")}.`);
  return parts.join(" ");
}

function makeBullets(signals: BundleResult, score: PersonalizedScore, v: Verbosity): string[] {
  const out: string[] = [];

  const pushIf = (cond: boolean, text: string) => { if (cond) out.push(text); };

  // Pull relevant subscores
  const b = score.breakdown;
  pushIf(b.speed > 0.7, "High probability of fast close (ads/commercial intent signals present).");
  pushIf(b.lifetime > 0.7, "Strong retention markers (reviews, hiring, ops stability).");
  pushIf(b.goodwill > 0.7, "Positive brand sentiment & referral likelihood.");
  pushIf(b.channelFit > 0.7, "Reachable via preferred channels (ads/social/email).");
  pushIf(b.opsFit > 0.7, "Operational needs align with your packaging capabilities.");
  pushIf(b.priceFit > 0.7, "Price leverage likely (commodity posture).");

  // Signal-specific highlights
  const s = getScores(signals);
  pushIf(s.commerce >= 0.6, `Active commerce footprint (score ${pct(s.commerce)}).`);
  pushIf(s.b2b_intent >= 0.6, `B2B buyer intent detected (score ${pct(s.b2b_intent)}).`);
  pushIf(s.reviews >= 0.6, `Meaningful review volume (score ${pct(s.reviews)}).`);
  pushIf(s.ops >= 0.6, `Operational maturity signals (score ${pct(s.ops)}).`);

  if (v === "detailed") {
    // Add 1–2 more concrete nuggets from signals evidence if available
    const ev = findEvidence(signals, ["ads", "hiring", "reviews", "commerce"]);
    for (const e of ev) {
      out.push(`${labelFor(e.id)}: ${clip(e.evidence || "signal detected", 140)}`);
    }
  }

  if (!out.length) out.push("Limited positive signals; keep in 'warm' watch-list pending fresh activity.");
  return out.slice(0, v === "detailed" ? 8 : 5);
}

function makeRisks(signals: BundleResult, company: CompanyProfile, cls?: Classification, v: Verbosity = "normal"): string[] {
  const out: string[] = [];
  const s = getScores(signals);

  if ((company.sizeHint === "501-1000" || company.sizeHint === "1000+")) out.push("Enterprise-size indication — may exceed target account size.");
  if (s.reviews < 0.3) out.push("Low public reviews; relationship proof may be limited.");
  if (s.ops < 0.3) out.push("Operational uncertainty; validate supply cadence and specs.");
  if (cls && cls.confidence < 0.5) out.push("Vertical classification uncertain; confirm buyer persona.");
  if ((company.emails?.length ?? 0) === 0 && (company.phones?.length ?? 0) === 0) out.push("Missing direct contacts; rely on social/ads outreach or enrichment.");

  return out.slice(0, v === "detailed" ? 6 : 4);
}

function makeNextSteps(signals: BundleResult, company: CompanyProfile): string[] {
  const steps: string[] = [];
  const s = getScores(signals);
  const hasEmail = (company.emails?.length ?? 0) > 0;
  const hasPhone = (company.phones?.length ?? 0) > 0;
  const socialN = Object.keys(company.socials || {}).length;

  if (hasEmail) steps.push("Send value-first email with packaging spec quiz + sample offer.");
  if (!hasEmail && socialN) steps.push("DM via active social handle with sample pack & MOQ check.");
  if (hasPhone && s.b2b_intent > 0.6) steps.push("Short discovery call: confirm SKUs, volumes, replenishment cadence.");
  if (s.commerce > 0.6) steps.push("Analyze PDP dimensions; propose optimized case-pack & freight savings.");
  if (s.reviews > 0.6) steps.push("Request co-branded case study contingent on on-time SLA.");
  if (!steps.length) steps.push("Monitor ads/reviews; re-score weekly until contactable.");

  return steps.slice(0, 5);
}

function makeLineage(signals: BundleResult) {
  const rows: Explanation["lineage"] = [];
  for (const b of signals.bundles) {
    rows.push({
      id: b.id,
      label: b.label,
      providers: b.sources?.map(s => s.provider),
      evidence: (b.data?.[0] as SignalDatum | undefined)?.snippet || b.summary,
    });
  }
  return rows;
}

// ------------------------------- utils ---------------------------

function getScores(signals: BundleResult): Record<string, number> {
  const ids = ["commerce", "b2b_intent", "ops", "reviews", "hiring", "ads"];
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = signals.byId?.[id]?.score ?? 0;
  return out;
}

function labelFor(id: string): string {
  const map: Record<string, string> = {
    commerce: "Commerce",
    b2b_intent: "B2B Intent",
    ops: "Ops Signals",
    reviews: "Reviews",
    hiring: "Hiring",
    ads: "Ads",
  };
  return map[id] || id;
}

function pct(n: number) { return `${Math.round(n * 100)}%`; }

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function tierWord(n: number) {
  if (n >= 85) return "excellent";
  if (n >= 75) return "strong";
  if (n >= 65) return "promising";
  return "moderate";
}
