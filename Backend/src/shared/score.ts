// src/shared/score.ts
//
// Artemis BV1 — Unified scoring core (catalog + web).
// - Deterministic "fit" from row + prefs (works today).
// - Optional "intent" & "recency" from dynamic Signals (safe if omitted).
// - Returns total score (0..100) + band (HOT/WARM/COOL) + reasons.
//
// Usage now:
//   import { scoreBuyer, upsertSignals } from "../shared/score";
//   const s = scoreBuyer({ row, prefs, city });
//   // s.score, s.band, s.reasons
//
// Later (optional signals):
//   upsertSignals("example.com", { adsActive:true, productLaunchDays:10 });

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { EffectivePrefs } from "./prefs";
import type { BuyerRow } from "./catalog";

/* ----------------------------- Types -------------------------------- */

export type Tier = "A" | "B" | "C";
export type Band = "HOT" | "WARM" | "COOL";

export type Signals = {
  // Optional, dynamic inputs (safe to omit)
  adsActive?: boolean;
  adsCreatives30d?: number;          // count of creatives last 30d
  productLaunchDays?: number | null; // days since launch post / new SKU
  siteUpdatedDays?: number | null;   // days since meaningful site change
  hiringPackaging?: boolean;         // job posts mentioning packaging
  storeCountDelta90d?: number;       // +N locations in last 90d
  inboundMentions30d?: number;       // PR / reviews / social
  // Extend freely as we add sources
};

export type ScoreDetail = {
  fit: number;        // 0..100 — persona/category/size/locality alignment
  intent: number;     // 0..100 — commercial signals
  recency: number;    // 0..100 — freshness proxy
  total: number;      // 0..100 — weighted
  recentDays: number; // min known "days since" among recency sources
  band: Band;         // HOT/WARM/COOL
  reasons: string[];  // short human crumbs
};

/* ------------------------ Local signals store ------------------------ */

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

/* ------------------------------- Env -------------------------------- */

const ENV = {
  HOT_MIN_TOTAL: n(process.env.HOT_MIN_TOTAL, 72),
  HOT_MIN_INTENT: n(process.env.HOT_MIN_INTENT, 60),
  HOT_MAX_RECENT_DAYS: n(process.env.HOT_MAX_RECENT_DAYS, 21),

  WARM_MIN_TOTAL: n(process.env.WARM_MIN_TOTAL, 55),
  WARM_MIN_INTENT: n(process.env.WARM_MIN_INTENT, 40),
  WARM_MAX_RECENT_DAYS: n(process.env.WARM_MAX_RECENT_DAYS, 90)
};
function n(v: any, d: number) { const x = Number(v); return Number.isFinite(x) ? x : d; }

/* ------------------------------ Helpers ------------------------------ */

function lc(s: unknown) { return String(s ?? "").trim().toLowerCase(); }
function asLowerArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => lc(x)).filter(Boolean);
}
function intersectCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  let c = 0; for (const x of a) if (set.has(x)) c++;
  return c;
}
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function normDays(v?: number | null) { return Number.isFinite(v as number) ? Math.max(0, Math.floor(v as number)) : 9999; }
function daysToScore(days: number): number {
  if (days <= 7) return 100;
  if (days >= 180) return 0;
  const span = 180 - 7;
  const d = clamp(days - 7, 0, span);
  return clamp(Math.round(100 - (d / span) * 100), 0, 100);
}
function tiersToSize(tiers: string[]): "micro"|"small"|"mid"|"large"|"unknown" {
  const t = (tiers[0] || "").toUpperCase();
  if (t === "A") return "large";
  if (t === "B") return "mid";
  if (t === "C") return "small";
  return "unknown";
}

/* ------------------------------- Core -------------------------------- */

export function scoreBuyer(input: {
  row: BuyerRow | any;      // tolerate loose shapes from web/catalog
  prefs: EffectivePrefs;
  city?: string;            // optional explicit city for locality boost
}): ScoreDetail {
  const row = input.row || {};
  const prefs = input.prefs || ({} as EffectivePrefs);
  const host = lc(row.host);
  const reasons: string[] = [];

  // --- FIT (persona/category/size/local) ---
  const want = asLowerArray((prefs as any).categoriesAllow);
  const have = new Set<string>([
    ...asLowerArray(row.tags),
    ...asLowerArray(row.segments),
  ]);
  let tagHits = 0; want.forEach((t) => { if (have.has(t)) tagHits++; });
  let fit = 0;
  if (tagHits > 0) {
    const pts = clamp(20 + tagHits * 8, 0, 45);
    fit += pts; reasons.push(`fit: ${tagHits} tag match${tagHits > 1 ? "es" : ""} (+${pts})`);
  }

  const sizeBucket = tiersToSize(asLowerArray(row.tiers));
  const sw = (prefs as any).sizeWeight || {};
  const sizeVal =
    sizeBucket === "micro" ? (sw.micro ?? 0) :
    sizeBucket === "small" ? (sw.small ?? 0) :
    sizeBucket === "mid"   ? (sw.mid   ?? 0) :
    sizeBucket === "large" ? (sw.large ?? 0) : 0;
  if (sizeVal) {
    const pts = clamp(Math.round(sizeVal * 12), -12, 18);
    fit += pts; reasons.push(`fit: size(${sizeBucket}) ${pts >= 0 ? "+" : ""}${pts}`);
  }

  const city = lc(input.city || (prefs as any).city);
  const rowCity = lc(row.city);
  if (city && rowCity && (rowCity.includes(city) || city.includes(rowCity))) {
    fit += 15; reasons.push("fit: local city match (+15)");
  }
  const sigW = (prefs as any).signalWeight || {};
  if ((sigW.local ?? 0) > 0.9) { fit += 6; reasons.push("fit: local bias (+6)"); }

  fit = clamp(fit, 0, 100);

  // --- INTENT (commercial posture) ---
  let intent = 0;
  const tags = asLowerArray(row.tags);
  if (tags.includes("ecommerce") && (sigW.ecommerce ?? 0) > 0.2) { intent += 10; reasons.push("intent: ecommerce (+10)"); }
  if (tags.includes("retail")    && (sigW.retail    ?? 0) > 0.2) { intent += 8;  reasons.push("intent: retail (+8)"); }
  if (tags.includes("wholesale") && (sigW.wholesale ?? 0) > 0.2) { intent += 8;  reasons.push("intent: wholesale (+8)"); }

  const sig = getSignals(host);
  if (sig.adsActive)                        { intent += 20; reasons.push("intent: ads running (+20)"); }
  if ((sig.adsCreatives30d ?? 0) > 4)       { intent += 6;  reasons.push("intent: many creatives (+6)"); }
  if (sig.hiringPackaging)                  { intent += 10; reasons.push("intent: hiring packaging (+10)"); }
  if ((sig.storeCountDelta90d ?? 0) > 0)    { intent += 6;  reasons.push("intent: store growth (+6)"); }
  if ((sig.inboundMentions30d ?? 0) > 0)    { intent += 5;  reasons.push("intent: recent mentions (+5)"); }

  intent = clamp(intent, 0, 100);

  // --- RECENCY (freshness proxy) ---
  const daysA = normDays(sig.productLaunchDays);
  const daysB = normDays(sig.siteUpdatedDays);
  const recentDays = Math.min(daysA, daysB, 9999);
  const recency = daysToScore(recentDays);

  // --- TOTAL + BAND ---
  const total = clamp(Math.round(0.60 * fit + 0.35 * intent + 0.05 * recency), 0, 100);
  const band: Band =
    total >= ENV.HOT_MIN_TOTAL  && intent >= ENV.HOT_MIN_INTENT  && recentDays <= ENV.HOT_MAX_RECENT_DAYS  ? "HOT"  :
    total >= ENV.WARM_MIN_TOTAL && intent >= ENV.WARM_MIN_INTENT && recentDays <= ENV.WARM_MAX_RECENT_DAYS ? "WARM" :
    "COOL";

  if (band === "HOT")  reasons.push("label: HOT (fit+intent+fresh)");
  else if (band === "WARM") reasons.push("label: WARM (fit+intent)");

  return { fit, intent, recency, total, recentDays, band, reasons: reasons.slice(0, 32) };
}

/* Convenience helper if a route only needs band+score */
export function scoreBasics(args: { row: any; prefs: EffectivePrefs; city?: string }) {
  const s = scoreBuyer(args);
  return { score: s.total, band: s.band, reasons: s.reasons };
}

export default { scoreBuyer, scoreBasics, upsertSignals, getSignals };