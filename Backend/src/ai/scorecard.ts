// Path: Backend/src/ai/scorecard.ts
// Purpose: Compose a single, UI-ready "scorecard" object per lead by blending
// demand (ads), product (PDP/SKU), procurement (intake), recency, user fit, and
// optional spend estimates. Also supports free-tier redaction.

import type { Weights, LeadRow, UserPrefs } from "../scoring";

// Optional peers (soft deps). Keep imports lazy-safe via type-only and guards.
// If you renamed these paths in your repo, update them here.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { estimateAdSpendUSD } from "../connectors/spend";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { buildWhy } from "./why";

// --------------------------- Types ---------------------------
export type VendorProfile = {
  industries?: string[];
  regions?: string[];
  materials?: string[];
  moq?: number;
  keywords?: string[];
};

export type AdSignal = {
  source: "meta" | "google" | "tiktok" | "other";
  proofUrl?: string;
  creatives?: number; // distinct creative count (if known)
  lastSeenDays?: number; // 0 = today
  geo?: string[]; // country codes
};

export type PDPSignal = {
  url: string;
  type: "case_of_n" | "restock_post" | "new_sku" | "pack_size" | "subscription";
  qtyCase?: number | null;
  weightKg?: number | null;
  dimsCm?: [number, number, number] | null;
  ts?: string; // ISO when detected
  title?: string | null;
  snippet?: string | null;
};

export type IntakeSignal = { url: string; title?: string | null; snippet?: string | null };

export type Signals = {
  ads?: AdSignal[];
  pdp?: PDPSignal[];
  intake?: IntakeSignal[];
};

export type Reason = { kind: string; text: string; weight?: number; meta?: Record<string, any> };

export type ScoreCard = {
  leadId?: number;
  domain: string;
  platform?: string | null;
  title?: string | null;
  snippet?: string | null;

  // blended scores (0–100)
  confidence: number; // overall confidence that this buyer is active/packaging-relevant
  demandScore: number; // from ad signals/spend, recency
  productScore: number; // from PDP, case-of-N, restock, etc.
  procurementScore: number; // from intake/supplier pages
  recencyScore: number; // minutes-to-now → 0–100
  userFitScore: number; // per-user boosts/mutes

  // estimates & tags
  estMonthlyAdSpendUSD?: number | null; // rough ad spend (if any)
  demandTier: "low" | "medium" | "high" | "surging";
  cues: string[]; // short tags for the UI chips (e.g., "case-of-12", "restock", "supplier-open")

  // narrative bullets ready for UI (free may be truncated)
  reasons: Reason[];

  // paywall hints (for UI to show locks)
  redacted?: boolean;
  redactions?: { reasonsHidden?: number; metricsHidden?: string[] };
};

export type ScoreCardInput = {
  vendor?: VendorProfile;
  lead: LeadRow & { domain?: string };
  signals: Signals;
  weights?: Weights; // global weights (optional)
  prefs?: UserPrefs; // per-user prefs (optional)
  createdAtIso?: string | null; // lead.created_at if available
  freeTier?: boolean; // if true → redact deep metrics
};

// --------------------------- Math helpers ---------------------------
const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const toPct = (x: number) => Math.round(clamp01(x) * 100);

function recencyTo01(createdAtIso?: string | null): number {
  if (!createdAtIso) return 0.35; // unknown → mild
  const ageMin = (Date.now() - new Date(createdAtIso).getTime()) / 60000;
  if (!Number.isFinite(ageMin) || ageMin < 0) return 1;
  // 0 min → 1.0, 240 min (4h) → 0.0 (linear fall)
  return clamp01(1 - ageMin / 240);
}

function demandFromAds(ads?: AdSignal[]): { score01: number; cues: string[]; spend?: number | null } {
  if (!ads || ads.length === 0) return { score01: 0, cues: [] };
  const lastSeenMin = Math.min(
    ...ads.map((a) => ((a.lastSeenDays ?? 30) * 1440) | 0)
  );
  const rec = clamp01(1 - lastSeenMin / (14 * 1440)); // full credit if seen within 14 days
  const creativeSum = ads.reduce((s, a) => s + Math.max(0, a.creatives ?? 0), 0);
  const creativeFactor = Math.min(1, creativeSum / 20); // 20 creatives → saturate

  // try spend estimate (soft dep)
  let spend: number | null = null;
  try {
    const ests = ads.map((a) => estimateAdSpendUSD?.({
      source: a.source,
      creatives: a.creatives ?? 0,
      lastSeenDays: a.lastSeenDays ?? null,
      geo: a.geo || [],
    }) || null);
    const vals = ests.filter((v): v is number => typeof v === "number" && v > 0);
    if (vals.length) spend = Math.round(vals.reduce((s, v) => s + v, 0));
  } catch {}

  const base = clamp01(0.55 * rec + 0.45 * creativeFactor); // blend
  const cues: string[] = [];
  if (creativeSum > 0) cues.push(`~${creativeSum} creatives`);
  if (lastSeenMin <= 1440) cues.push("seen <24h");
  if (spend && spend > 0) cues.push(`~$${spend.toLocaleString()} ads/mo`);
  return { score01: base, cues, spend };
}

function productFromPDP(pdp?: PDPSignal[]): { score01: number; cues: string[] } {
  if (!pdp || !pdp.length) return { score01: 0, cues: [] };
  let score = 0;
  const cues: string[] = [];
  for (const p of pdp) {
    if (p.type === "case_of_n" && (p.qtyCase ?? 0) > 1) {
      score += 0.22; cues.push(`case-of-${p.qtyCase}`);
    }
    if (p.type === "restock_post") { score += 0.28; cues.push("restock"); }
    if (p.type === "new_sku") { score += 0.25; cues.push("new SKU"); }
    if (p.type === "subscription") { score += 0.18; cues.push("subscribe"); }
  }
  return { score01: clamp01(score), cues };
}

function procurementFromIntake(intake?: IntakeSignal[]): { score01: number; cues: string[] } {
  if (!intake || !intake.length) return { score01: 0, cues: [] };
  const n = intake.length;
  const score = n >= 2 ? 0.6 : 0.4; // presence of multiple pages → stronger
  return { score01: score, cues: [n >= 2 ? "multiple supplier pages" : "supplier page"] };
}

function demandTier(score01: number): ScoreCard["demandTier"] {
  if (score01 >= 0.8) return "surging";
  if (score01 >= 0.55) return "high";
  if (score01 >= 0.25) return "medium";
  return "low";
}

function domainFromUrl(u?: string | null): string {
  try { return u ? new URL(u).hostname.toLowerCase() : ""; } catch { return ""; }
}

// --------------------------- Core builder ---------------------------
export function buildScoreCard(input: ScoreCardInput): ScoreCard {
  const { lead, signals, createdAtIso, prefs, freeTier } = input;
  const rec01 = recencyTo01(createdAtIso ?? (lead as any)?.created_at);

  const ads = demandFromAds(signals.ads);
  const pdp = productFromPDP(signals.pdp);
  const sup = procurementFromIntake(signals.intake);

  // Per-user soft boost if category/keywords match (very light; core fit lives in computeScore)
  let userFit = 0;
  if (prefs?.preferredCats && lead.cat && prefs.preferredCats.includes(lead.cat)) userFit += 0.15;
  if (prefs?.boostKeywords && lead.kw) {
    const hit = lead.kw.some((k) => (prefs!.boostKeywords as string[]).includes(k));
    if (hit) userFit += 0.1;
  }

  // Overall confidence blend. Keep intuitive and bounded.
  // More weight on demand (spend/recency), then product, then procurement, with recency everywhere.
  const conf01 = clamp01(0.44 * ads.score01 + 0.28 * pdp.score01 + 0.18 * sup.score01 + 0.10 * rec01 + userFit);

  const cues = [...ads.cues, ...pdp.cues, ...sup.cues];
  const card: ScoreCard = {
    leadId: Number(lead.id) || undefined,
    domain: (lead as any).domain || domainFromUrl(lead.source_url) || "",
    platform: lead.platform || null,
    title: lead.title || null,
    snippet: lead.snippet || null,

    confidence: toPct(conf01),
    demandScore: toPct(ads.score01),
    productScore: toPct(pdp.score01),
    procurementScore: toPct(sup.score01),
    recencyScore: toPct(rec01),
    userFitScore: toPct(clamp01(userFit)),

    estMonthlyAdSpendUSD: ads.spend ?? null,
    demandTier: demandTier(ads.score01),
    cues,

    reasons: [],
    redacted: false,
  };

  // Narrative bullets (delegate to why.ts if present; else generate light defaults)
  try {
    if (typeof buildWhy === "function") {
      card.reasons = buildWhy({ lead, signals, estSpendUSD: ads.spend || undefined, confidence01: conf01 });
    }
  } catch {}
  if (!card.reasons || !card.reasons.length) {
    // Fallback minimal bullets
    if (ads.score01 > 0) card.reasons?.push({ kind: "demand", text: `Active ads (${ads.cues.join(", ")})`, weight: 0.4 });
    if (pdp.score01 > 0) card.reasons?.push({ kind: "product", text: `Product signals: ${pdp.cues.join(", ")}`, weight: 0.3 });
    if (sup.score01 > 0) card.reasons?.push({ kind: "procurement", text: `Supplier intake present`, weight: 0.2 });
    card.reasons?.push({ kind: "recency", text: `Freshness score ${toPct(rec01)}%`, weight: 0.1 });
  }

  // Free-tier redaction: keep the headline, 2 reasons, hide deep metrics
  if (freeTier) {
    const keep = 2;
    const hidden = Math.max(0, (card.reasons?.length || 0) - keep);
    card.reasons = (card.reasons || []).slice(0, keep);
    card.redacted = hidden > 0;
    card.redactions = { reasonsHidden: hidden, metricsHidden: ["packaging_math", "import_trade", "retailer_cadence", "price_promo"] };
  }

  return card;
}

// Convenience to produce a UI JSON block
export function toUi(card: ScoreCard) {
  return {
    domain: card.domain,
    title: card.title,
    confidence: card.confidence,
    demandTier: card.demandTier,
    scores: {
      demand: card.demandScore,
      product: card.productScore,
      procurement: card.procurementScore,
      recency: card.recencyScore,
      userFit: card.userFitScore,
    },
    estMonthlyAdSpendUSD: card.estMonthlyAdSpendUSD ?? undefined,
    cues: card.cues,
    reasons: card.reasons,
    redacted: card.redacted || false,
    redactions: card.redactions || undefined,
  };
}

// --------------------------- Demo helper ---------------------------
export function demoScoreCard(): ScoreCard {
  const lead: LeadRow = {
    id: 123,
    platform: "pdp",
    source_url: "https://drinkolipop.com/products/variety-pack",
    title: "Variety Pack",
    snippet: "Case of 12 • Back in stock",
    created_at: new Date().toISOString(),
    cat: "product",
    kw: ["case", "pack", "dims"],
  };
  const signals: Signals = {
    ads: [
      { source: "meta", creatives: 8, lastSeenDays: 1, geo: ["US"] },
      { source: "google", creatives: 3, lastSeenDays: 3, geo: ["US"] },
    ],
    pdp: [
      { url: lead.source_url, type: "case_of_n", qtyCase: 12, title: lead.title || undefined },
      { url: lead.source_url, type: "subscription" },
    ],
    intake: [{ url: "https://drinkolipop.com/pages/suppliers", title: "Suppliers" }],
  };
  return buildScoreCard({ lead, signals, createdAtIso: lead.created_at, freeTier: true });
}
