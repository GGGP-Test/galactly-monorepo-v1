// src/shared/signals.ts
//
// Artemis BV1 — site "Signals" extractor.
// Cheap, deterministic signals from a fetched page (no extra network calls):
//   - Tech: ad pixels + platform stack (via detectTech)
//   - CTA strength: phone/email/form/quote/buy
//   - Commerce hints: cart/checkout/sku/pricing words/currency marks
//   - Recency hints: recent year + “new/launch” phrasing (dynamic years)
//   - Optional adsActivity (0..1) if caller supplies it
//
// Pure, dependency-free. Safe to run on every crawled HTML.

 /* eslint-disable @typescript-eslint/no-explicit-any */

import { detectTech, type TechSummary } from "./tech";

export type HeaderMap = Record<string, string | string[] | undefined>;

export type CTA = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasForm: boolean;
  hasQuote: boolean;  // "request a quote", "rfq", "get a quote"
  hasBuy: boolean;    // "add to cart", "buy now"
  count: number;      // sum of booleans
};

export type Commerce = {
  hasCart: boolean;
  hasCheckout: boolean;
  hasSku: boolean;
  hasPriceWord: boolean;
  currencyMarks: number; // count of $, €, £ (capped)
};

export type Recency = {
  hasRecentYear: boolean;
  recentYear?: number;      // latest acceptable year seen
  hasUpdateWords: boolean;  // "new", "now available", "launch", "just dropped"
};

export type Signals = {
  tech: TechSummary;
  pixels: TechSummary["pixels"];
  stack: TechSummary["stack"];
  pixelActivity: number; // from tech
  adsActivity: number;   // optional, default 0
  cta: CTA;
  commerce: Commerce;
  recency: Recency;
  keywordHits: string[]; // short notes like ["rfq","pricing","checkout"]
  reasons: string[];     // debug crumbs (cap ~32)
};

const toStr = (v: unknown) => (v == null ? "" : String(v));
const lc = (s: string) => s.toLowerCase();

// strip visible text (coarse, but fast and deterministic)
function stripTags(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/?[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return s.replace(/\s+/g, " ").trim();
}

function count(re: RegExp, s: string, capN = 999): number {
  let m: RegExpExecArray | null; let n = 0;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = r.exec(s))) { n++; if (n >= capN) break; }
  return n;
}
const bool = (re: RegExp, s: string) => re.test(s);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// find the most recent reasonable year in text (current year ±1, min 2019)
function findRecentYear(text: string): number | undefined {
  const now = new Date();
  const maxYear = now.getFullYear() + 1;
  const re = /\b(20\d{2})\b/g;
  let best = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const y = Number(m[1]);
    if (y >= 2019 && y <= maxYear && y > best) best = y;
  }
  return best || undefined;
}

export type ComputeInput = {
  html?: string;
  url?: string;
  headers?: HeaderMap;
  pageText?: string;     // if you already computed visible text; else we will
  adsActivity?: number;  // 0..1 optional — e.g., from ads-store
};

export function computeSignals(input: ComputeInput): Signals {
  const htmlRaw = toStr(input.html || "");
  const html = lc(htmlRaw);
  const text = lc(input.pageText || stripTags(htmlRaw));

  // 1) Tech (pixels + platform stack) — defensive in case detectTech hiccups
  let tech: TechSummary;
  try {
    tech = detectTech(htmlRaw, input.url, input.headers) as TechSummary;
  } catch {
    tech = { pixels: {} as any, stack: {} as any, pixelActivity: 0, reasons: ["tech:err"] } as any;
  }
  const pixelActivity = Number(tech?.pixelActivity || 0);

  // 2) CTA signals
  const hasPhone = bool(/\b(?:\+?\d{1,2}\s*)?(?:\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4})\b/, text);
  const hasEmail = bool(/mailto:|[\w.\-]+@[\w.\-]+\.[a-z]{2,}/i, htmlRaw);
  const hasForm = bool(/<form[\s>]/i, htmlRaw);
  const hasQuote = bool(/\b(request\s+a\s+quote|get\s+a\s+quote|rfq|quote\s*request)\b/i, text);
  const hasBuy = bool(/\b(add\s+to\s+cart|buy\s+now|checkout)\b/i, text);
  const cta: CTA = {
    hasPhone, hasEmail, hasForm, hasQuote, hasBuy,
    count: [hasPhone, hasEmail, hasForm, hasQuote, hasBuy].filter(Boolean).length,
  };

  // 3) Commerce hints
  const hasCart = bool(/\bcart\b|id=["']?cart\b|data-cart\b|\/cart\b/i, html);
  const hasCheckout = bool(/\bcheckout\b|\/checkout\b/i, html);
  const hasSku = bool(/\bsku\b|itemprop=["']?sku\b/i, html);
  const hasPriceWord = bool(/\b(price|pricing|moq|minimum\s+order)\b/i, text);
  const currencyMarks = Math.min(200, count(/[$€£]/g, htmlRaw));
  const commerce: Commerce = { hasCart, hasCheckout, hasSku, hasPriceWord, currencyMarks };

  // 4) Recency hints (dynamic year)
  const recentYear = findRecentYear(text);
  const hasRecentYear = !!recentYear;
  const hasUpdateWords = bool(/\b(new(?!sletter)|now\s+available|launch(ed|ing)?|just\s+(dropped|launched|released))\b/i, text);
  const recency: Recency = { hasRecentYear, recentYear, hasUpdateWords };

  // 5) Optional ads activity (0..1) from ads-store, else 0
  const adsActivity = clamp01(Number.isFinite(input.adsActivity as number) ? Number(input.adsActivity) : 0);

  // 6) Keyword hits (short tags for explain/debug)
  const keywordHits: string[] = [];
  if (cta.hasQuote) keywordHits.push("rfq");
  if (cta.hasBuy) keywordHits.push("buy");
  if (commerce.hasCheckout) keywordHits.push("checkout");
  if (commerce.hasCart) keywordHits.push("cart");
  if (commerce.hasPriceWord) keywordHits.push("pricing");
  if (hasUpdateWords) keywordHits.push("launch");
  if (hasRecentYear && recentYear) keywordHits.push(String(recentYear));

  // 7) Reasons (trace)
  const reasons = [
    ...(Array.isArray((tech as any).reasons) ? (tech as any).reasons : []),
    cta.hasQuote ? "cta:quote" : "",
    cta.hasBuy ? "cta:buy" : "",
    cta.hasForm ? "cta:form" : "",
    cta.hasEmail ? "cta:email" : "",
    cta.hasPhone ? "cta:phone" : "",
    commerce.hasCart ? "commerce:cart" : "",
    commerce.hasCheckout ? "commerce:checkout" : "",
    commerce.hasSku ? "commerce:sku" : "",
    commerce.hasPriceWord ? "commerce:pricing" : "",
    hasUpdateWords ? "recency:launch" : "",
    hasRecentYear && recentYear ? `recency:${recentYear}` : "",
    adsActivity > 0 ? `ads:${adsActivity.toFixed(2)}` : "",
  ].filter(Boolean);
  if (reasons.length > 32) reasons.length = 32;

  return {
    tech,
    pixels: (tech as any).pixels,
    stack: (tech as any).stack,
    pixelActivity,
    adsActivity,
    cta,
    commerce,
    recency,
    keywordHits,
    reasons,
  };
}

// Keep only essentials for logs/UIs
export function summarizeSignals(s: Signals) {
  return {
    pixelActivity: s.pixelActivity,
    adsActivity: s.adsActivity,
    cta: s.cta,
    commerce: { ...s.commerce, currencyMarks: Math.min(10, s.commerce.currencyMarks) },
    recency: s.recency,
    stack: s.stack,
    pixels: s.pixels,
  };
}

export default { computeSignals, summarizeSignals };