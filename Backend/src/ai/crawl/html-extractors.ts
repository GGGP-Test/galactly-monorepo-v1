// src/ai/crawl/html-extractors.ts

/**
 * Lightweight, dependency-free HTML scrapers that turn raw HTML into ExtractedSignals.
 * Heuristics only (no DOM); safe to run inside restricted workers/sandboxes.
 */

import type { ExtractedSignals } from "./types";

// ---------------- Dictionaries ----------------

const PACKAGING_TERMS = [
  "stretch wrap",
  "pallet wrap",
  "pallet film",
  "shrink wrap",
  "shrink film",
  "bundling film",
  "corrugated",
  "corrugated boxes",
  "custom boxes",
  "mailers",
  "poly mailers",
  "bubble mailers",
  "void fill",
  "packing peanuts",
  "air pillows",
  "inflatable void fill",
  "kraft paper",
  "packing paper",
  "tape",
  "water-activated tape",
  "wate activated tape",
  "wAT",
  "filament tape",
  "strapping",
  "poly strapping",
  "steel strapping",
  "labels",
  "shipping labels",
  "thermal labels",
  "bubble wrap",
  "foam wrap",
  "edge protectors",
  "corner guards",
  "stretch hood",
  "pallet covers",
  "gaylord",
  "poly bags",
  "zip lock bags",
  "zipper bags",
  "pouches",
  "sustainable packaging",
  "recycled packaging",
  "compostable mailers",
  "eco mailers",
];

const RFQ_TRIGGERS = [
  "request a quote",
  "request quote",
  "get a quote",
  "get quote",
  "rfq",
  "wholesale",
  "distributor",
  "supplier",
  "bulk pricing",
  "volume pricing",
  "moq",
  "minimum order",
  "purchase order",
  "net 30",
  "quote form",
  "bid",
];

const REVIEW_TERMS = [
  "reviews",
  "ratings",
  "testimonials",
  "trustpilot",
  "google reviews",
  "yotpo",
  "judge.me",
  "reviews.io",
  "sitejabber",
  "bbb rating",
];

const PLATFORM_SIGNATURES: Record<string, RegExp[]> = {
  Shopify: [/cdn\.shopify\.com/i, /x-shopify/i, /Shopify/i],
  WooCommerce: [/woocommerce/i, /wp-content\/plugins\/woocommerce/i, /generator" content="woocommerce/i],
  BigCommerce: [/cdn\d*\.bigcommerce/i, /bigcommerce/i],
  Magento: [/mage\/cookies/i, /Magento/i],
  Wix: [/static\.wixstatic\.com/i, /wix-code/i],
  Squarespace: [/squarespace\.com\/?v=\d/i, /sqs-block/i],
  Etsy: [/etsy\.com\/(shop|listing)/i],
  Amazon: [/amazon\.(com|ca)\/(dp|gp|stores)/i],
};

const ANALYTICS_SIGNATURES = [
  /www\.googletagmanager\.com\/gtm\.js/i,
  /gtag\('config'/i,
  /ga\('create'/i,
  /connect\.facebook\.net\/.*fbevents\.js/i,
  /hotjar\.com\/c\/hotjar/i,
  /clarity\.ms\/clarity/i,
  /tag\.hs-scripts\.com/i, // HubSpot
  /js\.pardot\.com/i,
];

const OPS_TERMS = [
  "warehouse",
  "fulfillment",
  "3pl",
  "pick and pack",
  "same-day",
  "same day",
  "kitting",
  "carrier",
  "dispatch",
  "dock",
  "pallet",
  "forklift",
  "inventory",
  "erp",
  "wms",
  "msi",
  "logistics",
  "shipstation",
  "shippo",
  "easyship",
  "fedex",
  "ups",
  "usps",
  "dhl",
];

const URGENCY_TERMS = [
  "rush",
  "expedite",
  "ships today",
  "ship today",
  "lead time",
  "backorder",
  "limited time",
  "sale ends",
  "flash sale",
  "low stock",
  "only X left",
  "restock",
];

const SUPPLIER_BRANDS = [
  "uline",
  "veritiv",
  "sealed air",
  "pregis",
  "westrock",
  "ipg",
  "intertape",
  "berry global",
  "avery dennison",
  "ds smith",
  "stora enso",
  "crown holdings",
  "amcor",
  "smurfit kappa",
];

// ---------------- Public API ----------------

export function extractSignalsFromHtml(html: string, url: string): ExtractedSignals {
  const base = sanitizeHtml(html ?? "");
  const text = toText(base);
  const lower = text.toLowerCase();

  const platformHints = detectPlatforms(base);
  const analyticsHints = detectAnalytics(base);
  const emails = grabEmails(base);
  const phones = grabPhones(base);
  const hasCart = detectCart(base);
  const ecommerceHint = hasCart ? guessEcom(platformHints) : undefined;

  const packagingKeywords = findKeywords(lower, PACKAGING_TERMS);
  const rfqPhrases = findPhrases(lower, RFQ_TRIGGERS);
  const reviewHints = findPhrases(lower, REVIEW_TERMS);
  const suppliersMentions = findSupplierMentions(lower);
  const careersLinks = findCareersLinks(base, url);
  const blogRecentness = detectRecentBlogDate(base);

  const demand = scoreDemand({ hasCart, rfqPhrases, packagingKeywords, lower });
  const procurement = scoreProcurement({ rfqPhrases, lower });
  const ops = scoreOps({ lower });
  const reputation = scoreReputation({ reviewHints, base });
  const urgency = scoreUrgency({ lower });

  return {
    title: grabTitle(base),
    description: grabMetaDescription(base),
    emails,
    phones,
    hasCart,
    ecommerceHint,
    packagingKeywords,
    rfqPhrases,
    reviewHints,
    platformHints,
    analyticsHints,
    careersLinks,
    suppliersMentions,
    blogRecentness,
    demand,
    procurement,
    ops,
    reputation,
    urgency,
  };
}

// ---------------- Heuristics ----------------

function sanitizeHtml(html: string) {
  // Remove script/style/comments to reduce noise
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
}

function toText(html: string) {
  return html
    .replace(/\s+/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function grabTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return m ? decode(m[1]).trim().slice(0, 200) : undefined;
}

function grabMetaDescription(html: string): string | undefined {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  return m ? decode(m[1]).trim().slice(0, 240) : undefined;
}

function decode(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function grabEmails(html: string): string[] {
  const set = new Set<string>();
  const rx = /([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) {
    const e = `${m[1]}@${m[2]}`.toLowerCase();
    if (!/(png|jpg|jpeg|gif)$/.test(e)) set.add(e);
  }
  return [...set].slice(0, 20);
}

function grabPhones(html: string): string[] {
  const set = new Set<string>();
  const rx = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) {
    set.add(m[0].replace(/\s+/g, " ").trim());
  }
  return [...set].slice(0, 20);
}

function detectCart(html: string): boolean {
  return /add to cart|cart-count|cart__count|checkout|data-cart-token/i.test(html);
}

function guessEcom(platformHints: string[]): string | undefined {
  if (!platformHints.length) return undefined;
  return platformHints[0];
}

function findKeywords(textLower: string, dict: string[]): string[] {
  const out: string[] = [];
  for (const term of dict) {
    const rx = new RegExp(`\\b${escapeReg(term)}\\b`, "i");
    if (rx.test(textLower)) out.push(term);
  }
  return uniq(out).slice(0, 50);
}

function findPhrases(textLower: string, dict: string[]): string[] {
  const out: string[] = [];
  for (const term of dict) {
    const rx = new RegExp(`${escapeReg(term)}`, "i");
    if (rx.test(textLower)) out.push(term);
  }
  return uniq(out).slice(0, 50);
}

function detectPlatforms(html: string): string[] {
  const hits: string[] = [];
  for (const [name, regs] of Object.entries(PLATFORM_SIGNATURES)) {
    if (regs.some((r) => r.test(html))) hits.push(name);
  }
  return hits;
}

function detectAnalytics(html: string): string[] {
  const hits: string[] = [];
  for (const r of ANALYTICS_SIGNATURES) if (r.test(html)) hits.push(r.source ?? r.toString());
  return hits;
}

function findCareersLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const rx = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html))) {
    const href = m[1];
    const text = m[2]?.toLowerCase() ?? "";
    if (/career|jobs|join our team|we're hiring|openings/.test(text)) {
      out.push(toAbsolute(baseUrl, href));
    }
  }
  return uniq(out).slice(0, 20);
}

function findSupplierMentions(lower: string): string[] {
  const out: string[] = [];
  for (const b of SUPPLIER_BRANDS) {
    const rx = new RegExp(`\\b${escapeReg(b)}\\b`, "i");
    if (rx.test(lower)) out.push(b);
  }
  return uniq(out).slice(0, 20);
}

function detectRecentBlogDate(html: string): { yyyy?: number; mm?: number } | undefined {
  // look for recent YYYY-MM or Month YYYY near blog/article markup
  const yearMatches = [...html.matchAll(/(?:20[12]\d)[-\/.](\d{1,2})/g)].map((m) => ({
    yyyy: parseInt(m[0].slice(0, 4), 10),
    mm: parseInt(m[1], 10),
  }));
  const alt = [...html.matchAll(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20[12]\d)/gi)].map((m) => ({
    yyyy: parseInt(m[2], 10),
    mm: monthToNum(m[1]),
  }));
  const all = [...yearMatches, ...alt].filter(Boolean);
  if (!all.length) return undefined;
  all.sort((a, b) => (b.yyyy! - a.yyyy!) || ((b.mm ?? 0) - (a.mm ?? 0)));
  return all[0];
}

function scoreDemand(ctx: { hasCart: boolean; rfqPhrases: string[]; packagingKeywords: string[]; lower: string }): number {
  let s = 0;
  if (ctx.hasCart) s += 0.35;
  s += Math.min(0.35, ctx.rfqPhrases.length * 0.12);
  s += Math.min(0.25, ctx.packagingKeywords.length * 0.04);
  if (/in stock|free shipping|volume discount|wholesale/i.test(ctx.lower)) s += 0.1;
  return clamp01(s);
}

function scoreProcurement(ctx: { rfqPhrases: string[]; lower: string }): number {
  let s = 0;
  s += Math.min(0.6, ctx.rfqPhrases.length * 0.15);
  if (/purchase order|net 30|terms|payment terms/i.test(ctx.lower)) s += 0.2;
  if (/distributor|supplier/i.test(ctx.lower)) s += 0.2;
  return clamp01(s);
}

function scoreOps(ctx: { lower: string }): number {
  let s = 0;
  s += Math.min(0.6, countHits(ctx.lower, OPS_TERMS) * 0.12);
  if (/same[- ]day|next[- ]day/i.test(ctx.lower)) s += 0.2;
  return clamp01(s);
}

function scoreReputation(ctx: { reviewHints: string[]; base: string }): number {
  let s = 0;
  s += Math.min(0.5, ctx.reviewHints.length * 0.12);
  if (/itemprop=["']reviewRating["']/i.test(ctx.base)) s += 0.25;
  if (/(class|aria-label)=["'][^"']*stars?/i.test(ctx.base)) s += 0.1;
  return clamp01(s);
}

function scoreUrgency(ctx: { lower: string }): number {
  return clamp01(Math.min(0.7, countHits(ctx.lower, URGENCY_TERMS) * 0.15));
}

// ---------------- Utils ----------------

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function countHits(textLower: string, terms: string[]): number {
  let c = 0;
  for (const t of terms) {
    const rx = new RegExp(`\\b${escapeReg(t)}\\b`, "i");
    if (rx.test(textLower)) c++;
  }
  return c;
}

function toAbsolute(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function monthToNum(mon: string): number | undefined {
  const idx = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(mon.toLowerCase().slice(0,3));
  return idx >= 0 ? idx + 1 : undefined;
}
