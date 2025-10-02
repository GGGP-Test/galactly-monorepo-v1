// src/shared/normalize.ts
//
// Small, dependency-free helpers for token/phrase normalization,
// de-duplication, scoring, and presentable labeling.
// These utilities intentionally have zero external deps so they are
// safe inside the crawler/extractor path.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- primitives -------------------------------------------------------

/** Remove accents/diacritics and normalize to ASCII-ish lowercase. */
export function canonicalToken(input: string): string {
  const s = String(input || "")
    .normalize("NFKD")
    // strip diacritics
    .replace(/[\u0300-\u036f]/g, "")
    // convert separators/punct to spaces
    .replace(/[_\-/.+|]+/g, " ")
    .toLowerCase()
    .trim();
  // collapse internal whitespace
  return s.replace(/\s+/g, " ");
}

/** Split text into canonical tokens (a..z0..9 words). */
export function tokenize(text: string): string[] {
  const s = canonicalToken(text);
  if (!s) return [];
  const words = s.split(/[^a-z0-9]+/g).filter(Boolean);
  // filter out too-short tokens that tend to be noise
  return words.filter((w) => w.length >= 2 && w.length <= 32);
}

/** De-duplicate while preserving first-seen order. */
export function dedupe<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string | T>();
  for (const v of arr) {
    const key = (typeof v === "string" ? `s:${v}` : v as any);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** Lowercase + trim + dedupe. */
export function uniqLower(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values || []) {
    const s = String(v || "").toLowerCase().trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Clamp with fallback when not a finite number. */
export function clamp(n: any, lo: number, hi: number, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
}

/** UTF-8 byte length (approx; JS string .length counts code units). */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Truncate string so its UTF-8 length <= maxBytes; adds ellipsis if trimmed. */
export function trimUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  // binary search cut point
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (enc.encode(s.slice(0, mid)).length <= maxBytes - 1) lo = mid + 1;
    else hi = mid;
  }
  const cut = Math.max(0, lo - 1);
  return s.slice(0, cut).trimEnd() + "…";
}

// ---------- counting / ranking ----------------------------------------------

/** Build a frequency map from a list of strings. */
export function countMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) {
    if (!t) continue;
    m.set(t, (m.get(t) || 0) + 1);
  }
  return m;
}

/** Merge counts from m2 into m1 with optional weight. */
export function mergeCounts(m1: Map<string, number>, m2: Map<string, number>, weight = 1): Map<string, number> {
  for (const [k, v] of m2.entries()) {
    m1.set(k, (m1.get(k) || 0) + v * weight);
  }
  return m1;
}

/** Convert {key->score} to top-N keys by score, stable by name on ties. */
export function topKeysByScore(scores: Map<string, number>, n = 10, minScore = 1): string[] {
  const arr = Array.from(scores.entries())
    .filter(([, v]) => (v || 0) >= minScore)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, Math.max(0, n))
    .map(([k]) => k);
  return arr;
}

/** Convenience: top N unique strings by frequency from a raw list. */
export function topNFromList(items: string[], n = 10, min = 1): string[] {
  return topKeysByScore(countMap(items), n, min);
}

// ---------- labeling / presentational helpers -------------------------------

/** Title-case with simple rules; keeps all-caps acronyms (e.g. FDA, SKU). */
export function toTitleCase(input: string): string {
  const s = String(input || "").trim();
  if (!s) return s;
  return s
    .split(/\s+/g)
    .map((w) => {
      if (/^[A-Z0-9]{2,}$/.test(w)) return w; // ACRONYM
      const lower = w.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** For city names: normalize spacing and title-case (keeps “St.” etc.). */
export function normalizeCity(input: string): string {
  const s = String(input || "")
    .replace(/\s+/g, " ")
    .replace(/[.,]+$/g, "")
    .trim();
  return toTitleCase(s);
}

/** Normalize host/URL-ish string to just the host (lowercase). */
export function normalizeHost(input: string): string {
  return (String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim());
}

/** Build a short “x, y, z” or “x, y & z” list with optional “+ more”. */
export function compactList(items: string[], maxShown = 3, moreWord = "more"): { text: string; used: string[] } {
  const uniq = dedupe(items.filter(Boolean));
  if (uniq.length === 0) return { text: "", used: [] };
  if (uniq.length <= maxShown) {
    const lastJoin = uniq.length === 2 ? " & " : ", ";
    if (uniq.length === 2) return { text: uniq.join(lastJoin), used: uniq };
    if (uniq.length === 3) return { text: `${uniq[0]}, ${uniq[1]} & ${uniq[2]}`, used: uniq };
    return { text: uniq.join(", "), used: uniq };
  }
  const used = uniq.slice(0, maxShown);
  const remain = uniq.length - used.length;
  const base =
    used.length === 1 ? used[0] :
    used.length === 2 ? `${used[0]} & ${used[1]}` :
    `${used[0]}, ${used[1]} & ${used[2]}`;
  return { text: `${base} + ${remain} ${moreWord}`, used };
}

// ---------- safety / misc ----------------------------------------------------

/** Guard a RegExp construction; returns undefined on failure. */
export function safeRegExp(pattern: string, flags?: string): RegExp | undefined {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

/** Normalize tags: lowercase, ASCII, trim, and drop obvious noise. */
export function normalizeTags(tags: string[], minLen = 2): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags || []) {
    const c = canonicalToken(t).replace(/[^a-z0-9 ]+/g, "").trim();
    if (!c) continue;
    for (const word of c.split(/\s+/g)) {
      if (word.length >= minLen && !seen.has(word)) {
        seen.add(word);
        out.push(word);
      }
    }
  }
  return out;
}

/** Split on commas and semicolons into trimmed parts. */
export function splitCsvish(s: string): string[] {
  return String(s || "")
    .split(/[;,]/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Safe stringify for debug logs (avoids throwing on circular). */
export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    try {
      return JSON.stringify(JSON.parse(String(v)));
    } catch {
      return String(v);
    }
  }
}