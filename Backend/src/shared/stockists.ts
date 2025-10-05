// src/shared/stockists.ts
//
// Artemis-B v1 — "Stockists / Where to buy" retail-shelf signal (dependency-free).
// Input: raw website text (crawler output). Output: 0..1 score + reasons.
//
// Exports:
//   extractStockists(text: string): StockistSignal
//   summarizeStockists(sig: StockistSignal, max=6): string
//
// Notes:
// - Pure string heuristics. Conservative to avoid false positives.
// - Saturating math keeps scores bounded.
// - Safe in both CJS & ESM builds (no runtime imports).

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Edge {
  retailer: string;
  weight: number;     // 1..3 depending on brand scale
  evidence: string;   // token that triggered it (for reasons/debug)
}

export interface StockistSignal {
  hasLocator: boolean;        // "store locator" present
  retailers: Edge[];          // detected named retailers
  channelMentions: string[];  // generic phrases like "available in stores"
  retailScore: number;        // 0..1
  totalRetailers: number;     // unique named retailers
  reasons: string[];          // compact strings
}

/* -------------------------------- utilities ------------------------------- */

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
function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ----------------------------- rule libraries ----------------------------- */

// Common store-locator phrases.
const LOCATOR_RE = /\b(store locator|find a store|where to buy|find us in stores|stockists|authorized dealers?)\b/i;

// A compact retailer lexicon (US-heavy; add more over time).
// weight ~ footprint strength for wholesale relevance.
const RETAILERS: Array<{ re: RegExp; name: string; weight: 1 | 2 | 3 }> = [
  // Big-box & grocery
  { re: /\b(target|target\s*plus)\b/i, name: "Target", weight: 3 },
  { re: /\bwalmart\b/i,                 name: "Walmart", weight: 3 },
  { re: /\bcostco\b/i,                  name: "Costco", weight: 3 },
  { re: /\bsams (?:club)?\b/i,          name: "Sam's Club", weight: 2 },
  { re: /\b(kroger|fred meyer|ralphs|fry's food)\b/i, name: "Kroger", weight: 2 },
  { re: /\bwhole\s*foods\b/i,           name: "Whole Foods", weight: 2 },
  { re: /\btrader joe'?s?\b/i,          name: "Trader Joe's", weight: 2 },
  { re: /\bsafeway\b/i,                 name: "Safeway", weight: 2 },
  { re: /\balbertsons\b/i,              name: "Albertsons", weight: 2 },
  { re: /\bhe?b\b/i,                    name: "HEB", weight: 2 },
  { re: /\bpublix\b/i,                  name: "Publix", weight: 2 },
  // Drug / beauty
  { re: /\b(cvs pharmacy|cvs)\b/i,      name: "CVS", weight: 2 },
  { re: /\bwalgreens\b/i,               name: "Walgreens", weight: 2 },
  { re: /\bulta\b/i,                    name: "Ulta", weight: 2 },
  { re: /\bsephora\b/i,                 name: "Sephora", weight: 2 },
  // Specialty / home / electronics
  { re: /\bbest ?buy\b/i,               name: "Best Buy", weight: 2 },
  { re: /\bhome depot\b/i,              name: "Home Depot", weight: 2 },
  { re: /\blowe'?s\b/i,                 name: "Lowe's", weight: 2 },
  { re: /\bbed bath(?: &| and)? beyond\b/i, name: "Bed Bath & Beyond", weight: 1 },
  // Outdoor / apparel
  { re: /\brei\b/i,                     name: "REI", weight: 2 },
  { re: /\bdick'?s sporting goods\b/i,  name: "Dick's Sporting Goods", weight: 2 },
  // Club/discount & dollar
  { re: /\bbj'?s wholesale\b/i,         name: "BJ's", weight: 1 },
  { re: /\bdollar (?:tree|general)\b/i, name: "Dollar Chain", weight: 1 },
  // Online marketplaces that still imply shelf / wholesale
  { re: /\bamazon (?:store|shop|brand|prime)\b/i, name: "Amazon", weight: 1 },
  { re: /\bwalmart\.com\b/i,            name: "Walmart.com", weight: 1 },
  { re: /\btarget\.com\b/i,             name: "Target.com", weight: 1 },
];

// Generic phrases implying offline retail availability.
const CHANNEL_HINTS = [
  /\bavailable in stores?\b/i,
  /\bnationwide in\b/i,
  /\bfind us at\b/i,
  /\bsold at\b/i,
  /\bretail partners?\b/i,
  /\bauthorized resellers?\b/i,
];

/* --------------------------------- core ----------------------------------- */

export function extractStockists(text: string): StockistSignal {
  const t = normWS(lc(text || ""));
  if (!t) {
    return { hasLocator: false, retailers: [], channelMentions: [], retailScore: 0, totalRetailers: 0, reasons: [] };
  }

  // Locator presence
  const hasLocator = LOCATOR_RE.test(t);

  // Named retailers
  const hits: Edge[] = [];
  for (const r of RETAILERS) {
    if (r.re.test(t)) {
      hits.push({ retailer: r.name, weight: r.weight, evidence: r.name.toLowerCase() });
    }
  }

  // Channel hints
  const ch: string[] = [];
  for (const re of CHANNEL_HINTS) if (re.test(t)) ch.push(re.source);

  // Dedup retailers by name; keep strongest weight
  const retailers = uniqBy(
    hits.sort((a, b) => b.weight - a.weight),
    x => x.retailer.toLowerCase()
  );

  // Score: saturate to avoid runaway pages.
  // Base from retailer weights + small bump for locator + channel hints.
  const raw =
    sum(retailers.map(r => r.weight)) + (hasLocator ? 2 : 0) + Math.min(2, ch.length * 0.5);

  const retailScore = sat(raw, 8); // cap ~a few strong retailers + locator
  const totalRetailers = retailers.length;

  // Reasons (compact)
  const reasons: string[] = [];
  if (hasLocator) reasons.push("locator");
  if (retailers.length) reasons.push(`retailers:${retailers.map(r => slug(r.retailer)).slice(0, 4).join("+")}`);
  if (ch.length) reasons.push("channel");
  if (reasons.length > 6) reasons.length = 6;

  return { hasLocator, retailers, channelMentions: ch, retailScore, totalRetailers, reasons };
}

export function summarizeStockists(sig: StockistSignal, maxShown = 6): string {
  if (!sig) return "no retail signals";
  const pct = Math.round(sig.retailScore * 100);
  const list = sig.retailers.map(r => cap(r.retailer)).slice(0, maxShown);
  const more = sig.retailers.length > maxShown ? ", etc." : "";
  const locator = sig.hasLocator ? "; locator" : "";
  return `${pct}% retail presence — ${list.join(", ")}${more}${locator}`;
}

/* -------------------------------- helpers --------------------------------- */

function sum(nums: number[]): number { return nums.reduce((a, b) => a + b, 0); }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

export default { extractStockists, summarizeStockists };