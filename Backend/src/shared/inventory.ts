// src/shared/inventory.ts
//
// Inventory & lead-time heuristics from a handful of pages (no deps).
// Pure + deterministic. Feed it HTML/text from your spider.
// Produces: product count hint, availability tilt, MOQ / lead-time hints.
//
// Usage:
//   const inv = assessInventory([{ url, html, text }, ...])
//   inv.score            // 0..100 inventory "readiness"
//   inv.productCountHint // estimated # of products
//   inv.availabilityHint // "in_stock_bias" | "mixed" | "out_of_stock_bias" | "unknown"
//   inv.moqHint          // boolean
//   inv.leadTimeHint     // boolean
//   inv.flags            // detailed signals
//
// This file is intentionally small and fast; it doesn’t fetch anything.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type InvPage = {
  url: string;
  html?: string;
  text?: string;
};

export type InvFlags = {
  // commerce surface
  hasShop: boolean;                // cart/forms/platform hints present
  productPageHits: number;         // pages that look like product PDP
  collectionPageHits: number;      // category/collection style pages

  // counts / schema
  productJsonCount: number;        // # JSON-LD Product items seen
  skuCount: number;                // SKU/part numbers detected

  // availability
  inStockHits: number;             // "in stock", "available", etc.
  outOfStockHits: number;          // "out of stock", "sold out", etc.
  preorderHits: number;            // "pre-order"
  backorderHits: number;           // "backorder"

  // logistics
  hasMoq: boolean;                 // MOQ phrases
  hasLeadTime: boolean;            // "lead time", "ships in X days" etc.
  leadDays: number[];              // extracted day counts

  // urgency
  shipsFastHits: number;           // "ships same day", "ships in 24h"
};

export type InventorySignal = {
  score: number;                   // 0..100 inventory “readiness”
  reasons: string[];
  productCountHint: number;        // best-effort estimate
  availabilityHint: "in_stock_bias" | "mixed" | "out_of_stock_bias" | "unknown";
  moqHint: boolean;
  leadTimeHint: boolean;
  leadDaysMedian: number | null;
  flags: InvFlags;
};

const lc = (s: any) => String(s ?? "").toLowerCase();
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function safeText(html?: string, text?: string): string {
  if (text) return String(text);
  const h = String(html || "");
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ----------------------------- detectors ------------------------------ */

const RE_PLATFORM =
  /(shopify|woocommerce|bigcommerce|magento|wix\-stores|swell|commercejs|ecwid|cart\.js|\/cart|add\-to\-cart|wp\-ecommerce)/i;

const RE_PDP_HINTS =
  /(add to cart|add to bag|buy now|qty|quantity|sku|model #|part #|product code)/i;

const RE_COLLECTION_HINTS =
  /(collections?\/|category\/|\/shop\/|filter by|sort by|refine|facets?)/i;

const RE_SKU =
  /\b(?:sku|item|part|model)[\s:#-]*([a-z0-9\-_.]{3,})\b/i;

const RE_IN_STOCK =
  /\b(in stock|available now|ready to ship|ships today)\b/i;

const RE_OUT_OF_STOCK =
  /\b(out of stock|sold out|currently unavailable)\b/i;

const RE_PREORDER = /\bpre[- ]?order\b/i;
const RE_BACKORDER = /\bback[- ]?order\b/i;

const RE_MOQ =
  /\b(moq|minimum\s*order(?:\s*qty|\s*quantity)?|min\.\s*order)\b/i;

const RE_LEAD =
  /\b(lead[- ]time|ships\s+in\s+\d+\s*(?:business\s*)?day|made[- ]to[- ]order|processing\s*time)\b/i;

const RE_LEAD_DAYS =
  /\b(?:ships|dispatch(?:es)?)\s+(?:in|within)\s+(\d{1,3})\s*(?:business\s*)?day/i;

const RE_SHIPS_FAST =
  /\b(same[- ]day shipping|ships within 24h|ships today)\b/i;

function count(re: RegExp, blob: string): number {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const m = blob.match(rx);
  return m ? Math.min(m.length, 50) : 0;
}

function extractLeadDays(blob: string): number[] {
  const out: number[] = [];
  const rx = new RegExp(RE_LEAD_DAYS.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(blob))) {
    const d = Number(m[1]);
    if (Number.isFinite(d) && d > 0 && d <= 365) out.push(d);
  }
  return out.slice(0, 20);
}

function detectProductJson(html?: string): number {
  if (!html) return 0;
  // very light JSON-LD scan
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  let n = 0;
  for (const s of scripts) {
    const body = (s.match(/>([\s\S]*?)<\/script>/i)?.[1] || "").trim();
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j)) {
        for (const el of j) if (isProductType(el)) n++;
      } else if (isProductType(j)) {
        n++;
      } else if (Array.isArray((j as any)["@graph"])) {
        for (const el of (j as any)["@graph"]) if (isProductType(el)) n++;
      }
    } catch {
      // ignore bad JSON
    }
  }
  return Math.min(n, 500);
}

function isProductType(obj: any): boolean {
  const t = lc(obj?.["@type"]);
  if (!t) return false;
  if (t.includes("product")) return true;
  if (Array.isArray(obj["@type"])) return (obj["@type"] as any[]).some(v => lc(v).includes("product"));
  return false;
}

/* ---------------------------- per-page scan ---------------------------- */

export function assessPageInventory(page: InvPage): InvFlags {
  const url = lc(page.url);
  const html = String(page.html || "");
  const text = safeText(page.html, page.text);
  const blob = html + "\n" + text;

  const hasShop = RE_PLATFORM.test(blob);
  const productPageHits = (RE_PDP_HINTS.test(blob) ? 1 : 0) + (/(\/product\/|productId=)/i.test(url) ? 1 : 0);
  const collectionPageHits = (RE_COLLECTION_HINTS.test(blob) ? 1 : 0) + (/(\/collection|\/category)/i.test(url) ? 1 : 0);

  const productJsonCount = detectProductJson(html);
  const skuCount = count(RE_SKU, blob);

  const inStockHits = count(RE_IN_STOCK, blob);
  const outOfStockHits = count(RE_OUT_OF_STOCK, blob);
  const preorderHits = count(RE_PREORDER, blob);
  const backorderHits = count(RE_BACKORDER, blob);

  const hasMoq = RE_MOQ.test(blob);
  const hasLeadTime = RE_LEAD.test(blob);
  const leadDays = extractLeadDays(blob);

  const shipsFastHits = count(RE_SHIPS_FAST, blob);

  return {
    hasShop,
    productPageHits,
    collectionPageHits,
    productJsonCount,
    skuCount,
    inStockHits,
    outOfStockHits,
    preorderHits,
    backorderHits,
    hasMoq,
    hasLeadTime,
    leadDays,
    shipsFastHits,
  };
}

/* ---------------------------- merge & score ---------------------------- */

export function mergeInvFlags(list: InvFlags[]): InvFlags {
  const base: InvFlags = {
    hasShop: false,
    productPageHits: 0,
    collectionPageHits: 0,
    productJsonCount: 0,
    skuCount: 0,
    inStockHits: 0,
    outOfStockHits: 0,
    preorderHits: 0,
    backorderHits: 0,
    hasMoq: false,
    hasLeadTime: false,
    leadDays: [],
    shipsFastHits: 0,
  };
  for (const f of list) {
    base.hasShop ||= f.hasShop;
    base.productPageHits += Math.max(0, f.productPageHits);
    base.collectionPageHits += Math.max(0, f.collectionPageHits);
    base.productJsonCount += Math.max(0, f.productJsonCount);
    base.skuCount += Math.max(0, f.skuCount);

    base.inStockHits += Math.max(0, f.inStockHits);
    base.outOfStockHits += Math.max(0, f.outOfStockHits);
    base.preorderHits += Math.max(0, f.preorderHits);
    base.backorderHits += Math.max(0, f.backorderHits);

    base.hasMoq ||= f.hasMoq;
    base.hasLeadTime ||= f.hasLeadTime;
    base.leadDays.push(...(f.leadDays || []));
    base.shipsFastHits += Math.max(0, f.shipsFastHits);
  }
  // tidy caps
  base.productJsonCount = Math.min(base.productJsonCount, 2000);
  base.skuCount = Math.min(base.skuCount, 500);
  base.inStockHits = Math.min(base.inStockHits, 100);
  base.outOfStockHits = Math.min(base.outOfStockHits, 100);
  base.preorderHits = Math.min(base.preorderHits, 50);
  base.backorderHits = Math.min(base.backorderHits, 50);
  base.shipsFastHits = Math.min(base.shipsFastHits, 50);
  base.leadDays = base.leadDays.slice(0, 100);
  return base;
}

function median(nums: number[]): number | null {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function productPoints(n: number): number {
  if (n >= 500) return 30;
  if (n >= 100) return 20;
  if (n >= 20) return 12;
  if (n >= 5) return 6;
  return 0;
}

export function assessInventory(pages: InvPage[]): InventorySignal {
  const per = (Array.isArray(pages) ? pages : []).map(assessPageInventory);
  const flags = mergeInvFlags(per);

  // Product count hint: JSON-LD products + PDP/page hints
  const productCountHint =
    Math.max(flags.productJsonCount, 0) +
    Math.max(0, Math.floor(flags.collectionPageHits * 8 + flags.productPageHits * 2));

  // Availability tilt
  let availability: InventorySignal["availabilityHint"] = "unknown";
  if (flags.inStockHits || flags.outOfStockHits) {
    const inR = flags.inStockHits;
    const outR = flags.outOfStockHits;
    availability =
      inR > outR * 1.2 ? "in_stock_bias" :
      outR > inR * 1.5 ? "out_of_stock_bias" :
      "mixed";
  }

  // Score
  let score = 0;
  const reasons: string[] = [];

  if (flags.hasShop) { score += 15; reasons.push("commerce-surface"); }
  const pp = productPoints(productCountHint);
  if (pp) { score += pp; reasons.push(`catalog~${productCountHint}`); }

  if (flags.skuCount > 0) { const add = Math.min(10, 2 + Math.floor(Math.log2(1 + flags.skuCount))); score += add; reasons.push(`sku+${flags.skuCount}`); }

  // Availability effects
  if (availability === "in_stock_bias") { score += 8; reasons.push("in-stock"); }
  if (availability === "out_of_stock_bias") { score -= 10; reasons.push("sold-out"); }

  // Logistics signals
  if (flags.hasMoq) { score += 4; reasons.push("moq"); }
  if (flags.hasLeadTime) { score += 6; reasons.push("lead-time"); }
  if (flags.shipsFastHits) { score += 4; reasons.push("ships-fast"); }

  const mLead = median(flags.leadDays);
  if (mLead !== null) {
    const adj = mLead <= 7 ? 4 : mLead <= 14 ? 2 : 0;
    if (adj) { score += adj; reasons.push(`lead≈${mLead}d`); }
  }

  score = clamp(score);

  return {
    score,
    reasons: reasons.slice(0, 12),
    productCountHint: Math.max(0, productCountHint),
    availabilityHint: availability,
    moqHint: !!flags.hasMoq,
    leadTimeHint: !!flags.hasLeadTime,
    leadDaysMedian: mLead,
    flags,
  };
}

/** Short line for logs. */
export function brief(inv: InventorySignal): string {
  const bits = [
    inv.productCountHint ? `prod~${inv.productCountHint}` : "",
    inv.availabilityHint !== "unknown" ? inv.availabilityHint : "",
    inv.moqHint ? "moq" : "",
    inv.leadTimeHint ? (inv.leadDaysMedian ? `lead~${inv.leadDaysMedian}d` : "lead") : "",
  ].filter(Boolean);
  return `inventory ${inv.score} — ${bits.join(", ") || "none"}`;
}

export default {
  assessInventory,
  assessPageInventory,
  mergeInvFlags,
  brief,
};