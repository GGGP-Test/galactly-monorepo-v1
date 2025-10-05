// src/shared/marketplaces.ts
//
// Artemis-B v1 — Marketplace & e-commerce footprint signal (dependency-free).
// Input: raw website text (crawler output). Output: compact 0..1 signals
// plus human-friendly reasons.
//
// Exports:
//   extractMarketplaces(text: string): MarketplaceSignal
//   summarizeMarketplaces(sig: MarketplaceSignal, max=6): string
//
// Notes:
// - Pure functions (no I/O), safe for both CJS & ESM builds.
// - Conservative patterns to reduce false positives.
// - Scoring saturates (never explodes with long pages).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CommercePlatform =
  | "shopify" | "woocommerce" | "bigcommerce" | "magento"
  | "squarespace" | "wix" | "ecwid" | "custom";

export type WholesaleMarketplace =
  | "amazon" | "etsy" | "ebay" | "walmart" | "alibaba"
  | "faire" | "handshake" | "tundra" | "rangeme" | "abound" | "targetplus";

export interface Edge<TName extends string> {
  name: TName;
  weight: number;     // heuristic weight (1..3)
  evidence: string;   // short token that triggered detection
}

export interface MarketplaceSignal {
  platforms: Edge<CommercePlatform>[];
  marketplaces: Edge<WholesaleMarketplace>[];
  reviews: Edge<"trustpilot" | "yotpo" | "judgeme" | "stamped" | "okendo" | "reviewsio" | "google_reviews">[];
  ecomScore: number;         // 0..1 (platform + checkout hints)
  marketplaceScore: number;  // 0..1
  reviewScore: number;       // 0..1
  totalScore: number;        // 0..1 (weighted blend)
  reasons: string[];         // compact strings like "platform:shopify", "market:amazon+faire"
}

/* --------------------------------- utils ---------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase();
const normWS = (s: string) => s.replace(/\s+/g, " ").trim();

function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

function sat(x: number, max: number): number {
  const clamped = Math.max(0, Math.min(max, x));
  return clamped / (max || 1);
}

/* --------------------------- detection rule sets -------------------------- */

type Rule<T extends string> = { name: T; re: RegExp; weight: number; evidence?: string };

const PLATFORM_RULES: Array<Rule<CommercePlatform>> = [
  { name: "shopify",     re: /\b(shopify|myshopify\.com|cdn\.shopify|checkout\.shopify|shop app|shop pay|shopify plus)\b/i, weight: 3, evidence: "shopify" },
  { name: "woocommerce", re: /\b(woocommerce|wc[-_]cart|wp-content\/plugins\/woocommerce|woo[-\s]?commerce)\b/i,            weight: 2, evidence: "woocommerce" },
  { name: "bigcommerce", re: /\b(bigcommerce|stencil-utils|cdn\d*\.bigcommerce)\b/i,                                        weight: 2, evidence: "bigcommerce" },
  { name: "magento",     re: /\b(magento|x-magento-vary|mage\/|varien|\.phtml\b)\b/i,                                        weight: 2, evidence: "magento" },
  { name: "squarespace", re: /\b(squarespace|static1\.squarespace|sqs-commerce)\b/i,                                         weight: 1, evidence: "squarespace" },
  { name: "wix",         re: /\b(wixstores|wixstatic\.com|wix ecommerce)\b/i,                                                weight: 1, evidence: "wix" },
  { name: "ecwid",       re: /\b(ecwid)\b/i,                                                                                  weight: 1, evidence: "ecwid" },
];

const MARKET_RULES: Array<Rule<WholesaleMarketplace>> = [
  { name: "amazon",     re: /\b(amazon\.com\/(shops|stores|dp|gp\/)|seller central|fulfilled by amazon|asin\b)\b/i, weight: 3, evidence: "amazon" },
  { name: "etsy",       re: /\betsy\.com\/(shop|listing|your)\b/i,                                                  weight: 2, evidence: "etsy" },
  { name: "ebay",       re: /\bebay\.com\/(itm|str|usr)|\bebay store\b/i,                                            weight: 2, evidence: "ebay" },
  { name: "walmart",    re: /\bwalmart\.com\/|walmart marketplace\b/i,                                               weight: 2, evidence: "walmart" },
  { name: "targetplus", re: /\btarget\+|\btarget plus marketplace\b/i,                                               weight: 2, evidence: "targetplus" },
  { name: "faire",      re: /\bfaire\.com\/(brand|invite|store|b2b)\b/i,                                             weight: 2, evidence: "faire" },
  { name: "handshake",  re: /\bhandshake\.com\b/i,                                                                    weight: 2, evidence: "handshake" },
  { name: "tundra",     re: /\btundra\.com\b/i,                                                                       weight: 2, evidence: "tundra" },
  { name: "rangeme",    re: /\brangeme\.com\b/i,                                                                      weight: 2, evidence: "rangeme" },
  { name: "abound",     re: /\b(helloabound\.com|abound\.com\/brand)\b/i,                                             weight: 2, evidence: "abound" },
  { name: "alibaba",    re: /\balibaba\.com\b|\b1688\.com\b/i,                                                        weight: 1, evidence: "alibaba" },
];

const REVIEW_RULES: Array<Rule<"trustpilot" | "yotpo" | "judgeme" | "stamped" | "okendo" | "reviewsio" | "google_reviews">> = [
  { name: "trustpilot",    re: /\btrustpilot\b/i,        weight: 1 },
  { name: "yotpo",         re: /\byotpo\b/i,             weight: 1 },
  { name: "judgeme",       re: /\bjudge\.?me\b/i,        weight: 1 },
  { name: "stamped",       re: /\bstamped(\.io)?\b/i,    weight: 1 },
  { name: "okendo",        re: /\bokendo\b/i,            weight: 1 },
  { name: "reviewsio",     re: /\breviews\.io\b/i,       weight: 1 },
  { name: "google_reviews",re: /\bgoogle customer reviews\b/i, weight: 1 },
];

// Generic commerce verbs that lightly indicate cart/checkout presence.
const CHECKOUT_HINTS = /\b(add to cart|add-to-cart|checkout|your cart|shopping cart|view cart|buy now)\b/i;

/* --------------------------------- core ----------------------------------- */

export function extractMarketplaces(text: string): MarketplaceSignal {
  const t = normWS(String(text || ""));
  if (!t) {
    return {
      platforms: [], marketplaces: [], reviews: [],
      ecomScore: 0, marketplaceScore: 0, reviewScore: 0, totalScore: 0, reasons: [],
    };
  }

  const platforms = detect(t, PLATFORM_RULES);
  const markets   = detect(t, MARKET_RULES);
  const reviews   = detect(t, REVIEW_RULES);

  // Light checkout bump if platform evidence is thin but UI text exists.
  const checkoutBump = CHECKOUT_HINTS.test(t) ? 1 : 0;

  // Scores (saturate to keep bounded)
  const ecomScore        = sat(sumWeight(platforms) + 0.5 * checkoutBump, 6);  // cap ~two strong hits
  const marketplaceScore = sat(sumWeight(markets), 6);
  const reviewScore      = sat(sumWeight(reviews), 4);

  // Blend (platforms weigh most; reviews least)
  const totalScore = Math.max(0, Math.min(1, 0.55 * ecomScore + 0.35 * marketplaceScore + 0.10 * reviewScore));

  // Reasons
  const reasons: string[] = [];
  if (platforms.length)  reasons.push(`platform:${platforms.map(p => p.name).slice(0, 3).join("+")}`);
  if (markets.length)    reasons.push(`market:${markets.map(m => m.name).slice(0, 3).join("+")}`);
  if (checkoutBump)      reasons.push("checkout");
  if (reviews.length)    reasons.push(`reviews:${reviews.map(r => r.name).slice(0, 2).join("+")}`);
  if (reasons.length > 6) reasons.length = 6;

  return {
    platforms, marketplaces: markets, reviews,
    ecomScore, marketplaceScore, reviewScore, totalScore, reasons,
  };
}

export function summarizeMarketplaces(sig: MarketplaceSignal, maxShown = 6): string {
  if (!sig) return "no commerce signals";
  const plats = sig.platforms.map(p => cap(p.name)).slice(0, 2).join(", ");
  const mkts  = sig.marketplaces.map(m => cap(m.name)).slice(0, maxShown).join(", ");
  const pct   = Math.round(sig.totalScore * 100);
  const left  = sig.marketplaces.length > maxShown ? ", etc." : "";
  const platTxt = plats ? `platforms: ${plats}` : "platforms: none";
  const mktTxt  = mkts ? `marketplaces: ${mkts}${left}` : "marketplaces: none";
  return `${pct}% commerce signal — ${platTxt}; ${mktTxt}`;
}

/* -------------------------------- helpers --------------------------------- */

function detect<T extends string>(text: string, rules: Array<Rule<T>>): Array<Edge<T>> {
  const hits: Array<Edge<T>> = [];
  for (const r of rules) {
    if (r.re.test(text)) hits.push({ name: r.name, weight: r.weight, evidence: r.evidence || r.name });
  }
  // Dedup by name; keep strongest
  return uniqBy(hits.sort((a, b) => b.weight - a.weight), x => x.name);
}

function sumWeight<T extends string>(edges: Array<Edge<T>>): number {
  return edges.reduce((s, e) => s + Math.max(1, Math.min(3, e.weight)), 0);
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export default { extractMarketplaces, summarizeMarketplaces };