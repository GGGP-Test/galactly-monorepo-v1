// src/shared/socialproof.ts
//
// Artemis-B v1 — Social Proof signal
// Heuristics for reviews (Google/Trustpilot/Yelp/BBB/G2/etc.), press/newsroom,
// awards/badges, and testimonials. Pure string parsing, no deps.
// Produces a 0..1 score + compact reasons for Step3 and TRC overlays.
//
// Exports:
//   extractSocialProof(text: string): SocialProofSignal
//   summarizeSocialProof(sig: SocialProofSignal, maxShown=5): string
//
// Safe for both CJS and ESM.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ReviewPlatform {
  platform: string;          // e.g., "google", "trustpilot"
  starsAvg: number | null;   // 0..5 if parsed
  count: number | null;      // number of reviews if parsed
  evidence: string[];        // compact tokens we matched
}

export interface SocialProofSignal {
  reviews: ReviewPlatform[]; // distinct by platform
  totalReviews: number;      // best-effort sum across platforms
  starsWeighted: number | null; // weighted avg stars (0..5) if we have both stars & counts
  testimonialsCount: number; // “testimonial”, “case study”, quotes, etc.
  pressMentions: string[];   // ["forbes", "techcrunch", ...] best-effort
  awards: string[];          // ["inc 5000", "best of...", "good design award", ...]
  recencyYear: number | null;// newest year we saw (e.g., 2024)
  socialScore: number;       // 0..1 overall
  reasons: string[];         // compact why (<= 8)
}

/* --------------------------------- utils ---------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase();
const normWS = (s: string) => s.replace(/\s+/g, " ").trim();

function uniq(arr: string[]): string[] {
  const s = new Set<string>();
  for (const v of arr) {
    const t = v.trim();
    if (t) s.add(t);
  }
  return [...s];
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function sat(n: number, capMax: number) { return capMax > 0 ? clamp(n, 0, capMax) / capMax : 0; }

function parseIntLoose(s?: string | number | null): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? Math.floor(n) : null;
}
function parseFloatLoose(s?: string | number | null): number | null {
  if (s == null) return null;
  const n = Number(String(s).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* -------------------------------- patterns -------------------------------- */

const REVIEW_PLATFORMS: Array<{ key: string; re: RegExp }> = [
  { key: "google",     re: /\bgoogle (?:reviews?|rating|maps)\b/i },
  { key: "trustpilot", re: /\btrustpilot\b/i },
  { key: "yelp",       re: /\byelp\b/i },
  { key: "bbb",        re: /\bbetter business bureau|bbb rating\b/i },
  { key: "g2",         re: /\bg2\s*(?:crowd)?\b/i },
  { key: "capterra",   re: /\bcapterra\b/i },
  { key: "yotpo",      re: /\byotpo\b/i },
  { key: "judge\.?me", re: /\bjudge\.?me\b/i },
  { key: "stamped",    re: /\bstamped(?:\.io)?\b/i },
  { key: "google-play",re: /\bgoogle play\b/i },
  { key: "app-store",  re: /\bapp store\b/i },
];

// e.g., "4.7/5", "Rated 4.8 out of 5", "★★★★★ 4.9"
const STARS_RE = /\b(?:rated\s*)?(\d(?:\.\d)?)\s*\/\s*5\b|([★]{3,5})/i;
// e.g., "(324 reviews)", "1,204 ratings", "based on 87 reviews"
const COUNT_RE = /\b(?:based on\s*)?(\d{1,3}(?:[, ]\d{3})*|\d+)\s*(?:reviews?|ratings?)\b/i;

const TESTIMONIAL_RE = /\b(testimonial|case studies?|customer stories?|what our customers say|success stories?)\b/i;

const PRESS_TOKENS = [
  "forbes","bloomberg","techcrunch","wired","the verge","wall street journal","wsj","cnbc","fast company",
  "hbr","nytimes","new york times","financial times","ft","reuters","ap news","inc."
];
const AWARD_TOKENS = [
  "inc 5000","inc. 5000","best of","design award","good design award","reddot","red dot","ces innovation",
  "finalist","winner","Editor's Choice","top 100","dieline award","packaging award","b corp certified"
];
const YEAR_RE = /\b(20(?:1[5-9]|2[0-9]|3[0-5]))\b/g; // 2015..2035 window

/* --------------------------------- core ----------------------------------- */

export function extractSocialProof(text: string): SocialProofSignal {
  const raw = normWS(String(text || ""));
  const t = lc(raw);

  // 1) Per-platform detection with optional stars/counts in nearby context
  const reviews: ReviewPlatform[] = [];
  for (const p of REVIEW_PLATFORMS) {
    if (!p.re.test(raw)) continue;
    const stars = findFirstFloatAround(raw, p.re, STARS_RE);
    const starFromGlyphs = glyphsToStars(findFirstGlyphsAround(raw, p.re, STARS_RE));
    const starsAvg = stars ?? starFromGlyphs;

    const count = findFirstIntAround(raw, p.re, COUNT_RE);
    const evidence: string[] = [];
    if (starsAvg != null) evidence.push(`stars:${starsAvg}`);
    if (count != null) evidence.push(`count:${count}`);

    reviews.push({ platform: p.key, starsAvg: starsAvg ?? null, count: count ?? null, evidence });
  }

  // 2) Testimonials
  const testimonialsCount = (t.match(TESTIMONIAL_RE) || []).length;

  // 3) Press & awards (presence-only lists)
  const pressMatches: string[] = [];
  for (const token of PRESS_TOKENS) if (t.includes(token)) pressMatches.push(token);
  const awards: string[] = [];
  for (const token of AWARD_TOKENS) if (t.includes(token.toLowerCase())) awards.push(token);

  // 4) Recency year
  let recencyYear: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = YEAR_RE.exec(raw))) {
    const y = parseIntLoose(m[1]);
    if (y && (!recencyYear || y > recencyYear)) recencyYear = y;
  }

  // 5) Aggregate totals and weighted avg stars
  const totalReviews = reviews.reduce((sum, r) => sum + (r.count || 0), 0);
  let starsWeighted: number | null = null;
  const weightedSum = reviews.reduce((s, r) => s + ((r.starsAvg ?? 0) * (r.count ?? 0)), 0);
  if (weightedSum > 0 && totalReviews > 0) starsWeighted = clamp(weightedSum / totalReviews, 0, 5);

  // 6) Score (cap=12): platforms up to 4 (1 each) + review volume up to 4 + star quality up to 2 + press up to 1 + awards up to 1
  let rawScore = 0;
  rawScore += Math.min(4, reviews.length);           // diversity of review sources
  rawScore += Math.min(4, volumeBucket(totalReviews)); // volume bucket 0..4
  rawScore += starsWeighted ? qualityBucket(starsWeighted) : 0; // 0..2
  rawScore += Math.min(1, pressMatches.length ? 1 : 0); // 0..1
  rawScore += Math.min(1, awards.length ? 1 : 0);       // 0..1
  const socialScore = sat(rawScore, 12);

  // 7) Reasons (<= 8)
  const reasons: string[] = [];
  if (reviews.length) reasons.push(`reviews:${reviews.length}p`);
  if (totalReviews) reasons.push(`count:${prettyNum(totalReviews)}`);
  if (starsWeighted != null) reasons.push(`stars:${starsWeighted.toFixed(1)}`);
  if (pressMatches.length) reasons.push(`press:${pressMatches.slice(0,3).join("+")}`);
  if (awards.length) reasons.push(`awards:${awards.slice(0,3).join("+")}`);
  if (testimonialsCount) reasons.push(`testimonials:${testimonialsCount}`);
  if (recencyYear) reasons.push(`year:${recencyYear}`);
  if (reasons.length > 8) reasons.length = 8;

  return {
    reviews,
    totalReviews,
    starsWeighted,
    testimonialsCount,
    pressMentions: uniq(pressMatches),
    awards: uniq(awards),
    recencyYear,
    socialScore,
    reasons,
  };
}

export function summarizeSocialProof(sig: SocialProofSignal, maxShown = 5): string {
  if (!sig) return "no social proof";
  const pct = Math.round((sig.socialScore || 0) * 100);
  const parts: string[] = [];
  if (sig.starsWeighted != null) parts.push(`${sig.starsWeighted.toFixed(1)}/5★`);
  if (sig.totalReviews) parts.push(`${prettyNum(sig.totalReviews)} reviews`);
  if (sig.pressMentions.length) parts.push(`press: ${sig.pressMentions.slice(0, maxShown).join(", ")}`);
  if (sig.awards.length) parts.push(`awards: ${sig.awards.slice(0, maxShown).join(", ")}`);
  return `${pct}% social — ${parts.join(" • ") || "no public reviews"}`;
}

/* ------------------------------ helpers ----------------------------------- */

// look around the first match of `anchorRe` for a stars/count pattern
function findFirstFloatAround(text: string, anchorRe: RegExp, valueRe: RegExp): number | null {
  const a = anchorRe.exec(text);
  if (!a) return null;
  const i = Math.max(0, a.index - 120);
  const j = Math.min(text.length, a.index + 200);
  const win = text.slice(i, j);
  const m = win.match(valueRe);
  if (!m) return null;
  // group1 is "4.7/5", group2 is glyphs — handled separately
  return m[1] ? parseFloatLoose(m[1]) : null;
}
function findFirstGlyphsAround(text: string, anchorRe: RegExp, valueRe: RegExp): string | null {
  const a = anchorRe.exec(text);
  if (!a) return null;
  const i = Math.max(0, a.index - 120);
  const j = Math.min(text.length, a.index + 200);
  const win = text.slice(i, j);
  const m = win.match(valueRe);
  if (!m) return null;
  return m[2] || null;
}
function glyphsToStars(glyphs: string | null): number | null {
  if (!glyphs) return null;
  const count = (glyphs.match(/★/g) || []).length;
  return count ? clamp(count, 0, 5) : null;
}
function findFirstIntAround(text: string, anchorRe: RegExp, valueRe: RegExp): number | null {
  const a = anchorRe.exec(text);
  if (!a) return null;
  const i = Math.max(0, a.index - 120);
  const j = Math.min(text.length, a.index + 200);
  const win = text.slice(i, j);
  const m = win.match(valueRe);
  if (!m) return null;
  return parseIntLoose(m[1]);
}

function volumeBucket(n: number): number {
  // crude buckets: 0, 1 (1–19), 2 (20–99), 3 (100–499), 4 (500+)
  if (n >= 500) return 4;
  if (n >= 100) return 3;
  if (n >= 20) return 2;
  if (n >= 1) return 1;
  return 0;
}
function qualityBucket(stars: number): number {
  // 0..2 where 4.6+ => 2, 4.0–4.5 => 1, else 0
  if (stars >= 4.6) return 2;
  if (stars >= 4.0) return 1;
  return 0;
}
function prettyNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export default { extractSocialProof, summarizeSocialProof };