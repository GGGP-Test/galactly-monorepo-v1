// src/shared/score.ts
//
// Production-ready scoring core for Artemis BV1.
// - Deterministic "fit" from catalog row + prefs (works today).
// - "Intent" & "Recency" from optional Signals (pluggable, safe defaults).
// - Returns a labeled tier: hot | warm | cold, with human reasons.
//
// How to use (now):
//   import { scoreBuyer, upsertSignals } from "./shared/score";
//   const s = scoreBuyer({ row, prefs });
//   // later when you detect signals:
//   upsertSignals(row.host, { adsActive:true, productLaunchDays:12 });
//
// No external config needed. Thresholds can be tuned via env but have sane defaults.

import type { EffectivePrefs } from "./prefs";
import type { BuyerRow } from "./catalog";

// --------- Types ---------

export type Signals = {
  // Boolean/numeric intent signals (optional; all safe if omitted)
  adsActive?: boolean;
  adsCreatives30d?: number;          // count of distinct creatives last 30d
  productLaunchDays?: number | null; // days since a launch post / PR / new SKU
  siteUpdatedDays?: number | null;   // days since meaningful website change
  hiringPackaging?: boolean;         // job posts mentioning packaging ops
  storeCountDelta90d?: number;       // +N stores in last 90d
  inboundMentions30d?: number;       // PR mentions / reviews / social
  // You can extend this type freely (we won’t crash on unknown keys).
};

export type ScoreBreakdown = {
  fit: number;        // 0..100
  intent: number;     // 0..100
  recency: number;    // 0..100 (freshness)
  total: number;      // 0..100 (weighted)
  recentDays: number; // min known "days since" among recency sources (or 9999)
  label: "hot" | "warm" | "cold";
  reasons: string[];
};

// --------- Local signals store (in-memory; optional) ----------

const SIG = new Map<string, Signals>();
export function upsertSignals(host: string, patch: Signals) {
  const h = (host || "").trim().toLowerCase();
  if (!h) return;
  SIG.set(h, { ...(SIG.get(h) || {}), ...patch });
}
export function getSignals(host: string): Signals {
  const h = (host || "").trim().toLowerCase();
  return SIG.get(h) || {};
}

// --------- Helpers ----------

function asLowerArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x ?? "").trim().toLowerCase()).filter(Boolean);
}

function intersectCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let c = 0;
  for (const x of a) if (set.has(x)) c++;
  return c;
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

// --------- Env-tunable thresholds (with strong defaults) ----------

const ENV = {
  HOT_MIN_TOTAL: num(process.env.HOT_MIN_TOTAL, 72),
  HOT_MIN_INTENT: num(process.env.HOT_MIN_INTENT, 60),
  HOT_MAX_RECENT_DAYS: num(process.env.HOT_MAX_RECENT_DAYS, 21),

  WARM_MIN_TOTAL: num(process.env.WARM_MIN_TOTAL, 55),
  WARM_MIN_INTENT: num(process.env.WARM_MIN_INTENT, 40),
  WARM_MAX_RECENT_DAYS: num(process.env.WARM_MAX_RECENT_DAYS, 90)
};

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// --------- Core scoring ----------

export function scoreBuyer(input: {
  row: BuyerRow | any;      // tolerate loose shapes
  prefs: EffectivePrefs;
  hostOverride?: string;    // optional explicit host
}): ScoreBreakdown {
  const row = input.row || {};
  const prefs = input.prefs || ({} as EffectivePrefs);
  const host = (input.hostOverride || row.host || "").toLowerCase();

  const tiers = asLowerArray(row.tiers);
  const tags = asLowerArray(row.tags);
  const segments = asLowerArray(row.segments);
  const cityTags = asLowerArray(row.cityTags);

  // ---- FIT -----------------------------------------------------
  const reasons: string[] = [];
  let fit = 0;

  // Tag/segment match with persona categories
  const wants = asLowerArray(prefs.categoriesAllow);
  const tagHits = intersectCount(wants, [...tags, ...segments]);
  if (tagHits > 0) {
    const tagScore = clamp(20 + tagHits * 8, 0, 45);
    fit += tagScore;
    reasons.push(`fit: ${tagHits} tag match${tagHits > 1 ? "es" : ""} (+${tagScore})`);
  }

  // Size preference via tier mapping
  // Map tiers to size buckets (tweakable later).
  const size = tierToSizeBucket(tiers);
  const sz = prefs.sizeWeight || {};
  const sizeVal =
    size === "micro" ? (sz.micro ?? 0) :
    size === "small" ? (sz.small ?? 0) :
    size === "mid"   ? (sz.mid   ?? 0) :
    size === "large" ? (sz.large ?? 0) : 0;

  if (sizeVal !== 0) {
    // convert -1.5..+1.5ish into points
    const pts = clamp(Math.round(sizeVal * 12), -12, 18);
    fit += pts;
    reasons.push(`fit: size(${size}) ${pts >= 0 ? "+" : ""}${pts}`);
  }

  // Locality boost if persona city matches any cityTag
  const city = (prefs.city || "").trim().toLowerCase();
  if (city && cityTags.includes(city)) {
    fit += 15;
    reasons.push(`fit: local city match (+15)`);
  }

  // Persona general knobs -> signal weights proxy
  const sw = prefs.signalWeight || {};
  const localBias = (sw.local ?? 0) > 0.9 ? 6 : 0;
  if (localBias) {
    fit += localBias;
    reasons.push(`fit: local bias (+${localBias})`);
  }

  fit = clamp(fit, 0, 100);

  // ---- INTENT --------------------------------------------------
  // Base intent inferred from tags (ecommerce/retail/wholesale) × persona interest
  let intent = 0;

  const hasEcom = tags.includes("ecommerce");
  const hasRetail = tags.includes("retail");
  const hasWholesale = tags.includes("wholesale");

  if (hasEcom && (sw.ecommerce ?? 0) > 0.2) { intent += 10; reasons.push(`intent: ecommerce (+10)`); }
  if (hasRetail && (sw.retail ?? 0) > 0.2)   { intent += 8;  reasons.push(`intent: retail (+8)`); }
  if (hasWholesale && (sw.wholesale ?? 0) > 0.2) { intent += 8; reasons.push(`intent: wholesale (+8)`); }

  // External / dynamic signals (optional)
  const sig = getSignals(host);
  if (sig.adsActive) { intent += 20; reasons.push(`intent: ads running (+20)`); }
  if ((sig.adsCreatives30d ?? 0) > 4) { intent += 6; reasons.push(`intent: many creatives (+6)`); }
  if (sig.hiringPackaging) { intent += 10; reasons.push(`intent: hiring packaging (+10)`); }
  if ((sig.storeCountDelta90d ?? 0) > 0) { intent += 6; reasons.push(`intent: store growth (+6)`); }
  if ((sig.inboundMentions30d ?? 0) > 0) { intent += 5; reasons.push(`intent: recent mentions (+5)`); }

  intent = clamp(intent, 0, 100);

  // ---- RECENCY -------------------------------------------------
  const daysA = normDays(sig.productLaunchDays);
  const daysB = normDays(sig.siteUpdatedDays);
  const recentDays = Math.min(daysA, daysB, 9999);

  // Convert days → 0..100 where fresh (<=7d) ~ 100, stale (>=180d) ~ 0
  const recency = daysToScore(recentDays);

  // ---- TOTAL + LABEL -------------------------------------------
  const total = clamp(Math.round(0.60 * fit + 0.35 * intent + 0.05 * recency), 0, 100);

  const label = labelByThresholds({
    total,
    intent,
    recentDays
  });

  if (label === "hot") reasons.push("label: HOT (fit+intent+fresh)");
  else if (label === "warm") reasons.push("label: warm (fit+intent)");

  return { fit, intent, recency, total, recentDays, label, reasons };
}

// --------- Internals ----------

function tierToSizeBucket(tiers: string[]): "micro"|"small"|"mid"|"large"|"unknown" {
  const t = (tiers[0] || "").toLowerCase();
  if (t === "a") return "large";
  if (t === "b") return "mid";
  if (t === "c") return "small";
  return "unknown";
}

function normDays(v?: number | null): number {
  if (!Number.isFinite(v as number)) return 9999;
  return Math.max(0, Math.floor(v as number));
}

function daysToScore(days: number): number {
  if (days <= 7) return 100;
  if (days >= 180) return 0;
  // linear-ish drop from 7d..180d
  const span = 180 - 7;
  const d = clamp(days - 7, 0, span);
  return clamp(Math.round(100 - (d / span) * 100), 0, 100);
}

function labelByThresholds(x: { total: number; intent: number; recentDays: number }): "hot" | "warm" | "cold" {
  if (x.total >= ENV.HOT_MIN_TOTAL && x.intent >= ENV.HOT_MIN_INTENT && x.recentDays <= ENV.HOT_MAX_RECENT_DAYS) {
    return "hot";
  }
  if (x.total >= ENV.WARM_MIN_TOTAL && x.intent >= ENV.WARM_MIN_INTENT && x.recentDays <= ENV.WARM_MAX_RECENT_DAYS) {
    return "warm";
  }
  return "cold";
}