// src/shared/trc.ts
//
// Tier-C (small/micro buyer) heuristics and helpers.
// Pure functions: safe to import from routes or jobs.
// Nothing here mutates global state.

// Imports are type-only to keep this module side-effect free.
import type { EffectivePrefs, SizeBucket } from "./prefs";
import type { BuyerRow } from "./catalog";

// ---------------------
// Normalization helpers
// ---------------------

/** Lowercase, strip accents, collapse spaces (for city/tag matching). */
export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quick set building utility. */
function setOf<T extends string | number>(xs: T[] | undefined | null): Set<T> {
  return new Set((xs || []) as T[]);
}

/** Extract all normalized tags (tags[] + segments[]), unique. */
export function allTags(row: BuyerRow): string[] {
  const out = new Set<string>();
  for (const arr of [row.tags as string[] | undefined, row.segments as string[] | undefined]) {
    if (!arr) continue;
    for (const t of arr) {
      const v = norm(String(t));
      if (v) out.add(v);
    }
  }
  return [...out];
}

/** Does the row have a specific (normalized) tag? */
export function hasTag(row: BuyerRow, tag: string): boolean {
  const needle = norm(tag);
  if (!needle) return false;
  return allTags(row).some((t) => t === needle);
}

/** Return any numeric token after a key pattern like "store_count:42". */
function tagNumber(row: BuyerRow, key: string): number | undefined {
  const k = norm(key) + ":";
  for (const t of allTags(row)) {
    if (t.startsWith(k)) {
      const num = Number(t.slice(k.length));
      if (Number.isFinite(num)) return num;
    }
  }
  return undefined;
}

// ---------------------
// Geo / locality checks
// ---------------------

/** True if row is tagged with the same city (exact or near-synonym). */
export function isLocalToCity(row: BuyerRow, city: string | undefined): boolean {
  if (!city) return false;
  const want = norm(city);
  if (!want) return false;

  // Primary source: cityTags[] (already normalized-ish in our catalogs)
  const cities = (row as any).cityTags as string[] | undefined;
  if (cities && cities.some((c) => norm(c) === want)) return true;

  // Secondary: free-form tags like "city:los angeles" or "geo:los angeles"
  const tags = allTags(row);
  for (const t of tags) {
    if (t.startsWith("city:") || t.startsWith("geo:")) {
      const v = t.split(":")[1] || "";
      if (norm(v) === want) return true;
    }
  }
  return false;
}

// ---------------------
// Size estimation
// ---------------------

/**
 * Estimate buyer size bucket from weak signals.
 * We bias toward "micro/small" unless strong signals say otherwise.
 */
export function estimateSize(row: BuyerRow): SizeBucket {
  const tags = setOf(allTags(row));
  const storeCount = tagNumber(row, "store_count");
  const employees = tagNumber(row, "employees");
  const revenue = tagNumber(row, "revenue_usd_m"); // e.g. "revenue_usd_m:12"

  // Strong large/mid signals
  if ((storeCount ?? 0) >= 50) return "large";
  if ((employees ?? 0) >= 250) return "large";
  if ((revenue ?? 0) >= 100) return "large";

  if ((storeCount ?? 0) >= 10) return "mid";
  if ((employees ?? 0) >= 50) return "mid";
  if ((revenue ?? 0) >= 10) return "mid";

  // E-com / craft-platform hints → micro/small
  if (tags.has("etsy") || tags.has("shopify") || tags.has("woocommerce")) {
    return "micro";
  }

  // Food truck / single-location cafe, salon, boutique → micro/small
  const singleLocationHints = ["single location", "one store", "local shop"];
  if (singleLocationHints.some((h) => tags.has(norm(h)))) return "micro";

  // Default small
  return "small";
}

// ---------------------
// Commercial channel hints
// ---------------------

export interface ChannelHints {
  ecommerce: boolean;
  retail: boolean;
  wholesale: boolean;
}

export function channelHints(row: BuyerRow): ChannelHints {
  const tags = setOf(allTags(row));
  return {
    ecommerce:
      tags.has("ecommerce") ||
      tags.has("e-commerce") ||
      tags.has("shopify") ||
      tags.has("etsy") ||
      tags.has("woocommerce"),
    retail:
      tags.has("retail") ||
      tags.has("grocery") ||
      tags.has("boutique") ||
      (tagNumber(row, "store_count") ?? 0) > 0,
    wholesale: tags.has("wholesale") || tags.has("distributor") || tags.has("b2b"),
  };
}

// ---------------------
// Scoring (not wired yet)
// ---------------------

export interface ScoreDetail {
  size: SizeBucket;
  base: number;          // from size weight
  localBoost: number;    // locality bonus
  channelBoost: number;  // ecom/retail/wholesale nudges
  total: number;
  reasons: string[];     // human readable
}

/**
 * Compute a continuous score for a BuyerRow given effective prefs.
 * (We’ll map continuous → warm/hot thresholds in the route.)
 */
export function scoreRow(row: BuyerRow, prefs: EffectivePrefs): ScoreDetail {
  const reasons: string[] = [];
  const size = estimateSize(row);
  let total = 0;

  // Size weight
  const base = Number(prefs.sizeWeight[size] ?? 0);
  total += base;
  reasons.push(`size=${size}(w=${base})`);

  // Locality
  let localBoost = 0;
  if (isLocalToCity(row, prefs.city)) {
    localBoost = Number(prefs.signalWeight.local ?? 0);
    total += localBoost;
    reasons.push(`local(+${localBoost})`);
  }

  // Channel nudges
  const ch = channelHints(row);
  let channelBoost = 0;
  if (ch.ecommerce) {
    channelBoost += Number(prefs.signalWeight.ecommerce ?? 0);
    reasons.push(`ecom(+${prefs.signalWeight.ecommerce ?? 0})`);
  }
  if (ch.retail) {
    channelBoost += Number(prefs.signalWeight.retail ?? 0);
    reasons.push(`retail(+${prefs.signalWeight.retail ?? 0})`);
  }
  if (ch.wholesale) {
    channelBoost += Number(prefs.signalWeight.wholesale ?? 0);
    reasons.push(`wholesale(+${prefs.signalWeight.wholesale ?? 0})`);
  }
  total += channelBoost;

  return { size, base, localBoost, channelBoost, total, reasons };
}

/** Simple thresholds we’ll tune later when wiring to /leads. */
export function classifyScore(total: number): "cold" | "warm" | "hot" {
  if (total >= 1.8) return "hot";
  if (total >= 0.9) return "warm";
  return "cold";
}

// ---------------------
// Pretty “why” builder
// ---------------------

export function buildWhy(detail: ScoreDetail): string {
  const parts = [
    ...detail.reasons,
    `score=${detail.total.toFixed(2)}`,
  ];
  return parts.join(" • ");
}