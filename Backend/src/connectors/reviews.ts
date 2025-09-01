/**
 * connectors/reviews.ts
 * Lightweight public-reviews aggregator with graceful fallbacks.
 *
 * Uses Google CSE if GOOGLE_API_KEY + GOOGLE_CX_* are present;
 * otherwise returns null (so callers can skip or cache last known).
 *
 * Output is intentionally compact & vendor-agnostic so free users
 * see capability without reverse-engineering your source list.
 */

import fetch from "node-fetch";

type ReviewSource = {
  source: "trustpilot" | "google" | "yelp" | "site_reviews" | "web";
  url?: string;
  rating?: number;   // 0..5
  count?: number;    // # of reviews
  pkgMentions?: number; // packaging-related mentions (rough)
};

export type ReviewSignals = {
  domain: string;
  rating?: number;         // weighted avg 0..5
  count?: number;          // total reviews observed
  pkgMentions?: number;    // count of packaging/damage terms in snippets
  updatedAt: string;
  sources: ReviewSource[];
};

const sleep = (ms:number)=> new Promise(r=>setTimeout(r,ms));

// --- tiny CSE helper (no external dependency on your cse.ts) ---
async function cseSearch(q: string, num = 5): Promise<Array<{title:string,snippet:string,link:string}>> {
  const key = process.env.GOOGLE_API_KEY;
  const cxCandidates = Object.keys(process.env)
    .filter(k => /^GOOGLE_CX_/i.test(k) && process.env[k])
    .map(k => String(process.env[k]));
  if (!key || !cxCandidates.length) return [];
  const cx = cxCandidates[Math.floor(Math.random()*cxCandidates.length)];
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=${num}`;
  const r = await fetch(url, { timeout: 12000 as any }).catch(() => null);
  if (!r || !r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((it:any)=>({ title: String(it.title||''), snippet: String(it.snippet||''), link: String(it.link||'') }));
}

// --- parsing helpers ---
const NUM = /([0-9][0-9,\.]*)/;
function parseRating(snippet: string): number|undefined {
  // e.g. "Rating 4.3 · 1,204 reviews" or "4.1 stars"
  const s = snippet.toLowerCase();
  const m = s.match(/([0-9]\.?[0-9]?)\s*(?:out of|\/)\s*5|([0-9]\.?[0-9]?)\s*stars?/);
  if (!m) return undefined;
  const val = Number((m[1] ?? m[2])?.replace(/,/g,''));
  return Number.isFinite(val) ? Math.max(0, Math.min(5, val)) : undefined;
}
function parseCount(snippet: string): number|undefined {
  const m = snippet.toLowerCase().match(NUM.source + "\\s*reviews");
  if (!m) return undefined;
  const val = Number(String(m[1]).replace(/,/g,''));
  return Number.isFinite(val) ? Math.max(0, val) : undefined;
}
function packagingHits(text: string): number {
  const s = text.toLowerCase();
  const keys = [
    "packaging", "damaged", "broken seal", "leaked", "leaking",
    "dented", "ripped", "torn box", "poorly packed", "bottle broke",
    "spilled", "seal broken", "arrived crushed", "shattered"
  ];
  return keys.reduce((n,k)=> n + (s.includes(k) ? 1 : 0), 0);
}
function hostFromDomain(domain: string) {
  return domain.replace(/^https?:\/\//i, "").replace(/\/.+$/,"");
}

// --- main ---
export async function fetchReviewSignals(domain: string): Promise<ReviewSignals|null> {
  const host = hostFromDomain(domain);
  if (!host) return null;

  const brandGuess = host.split(".")[0]; // crude but works surprisingly well

  const queries = [
    // prioritized sources
    `${brandGuess} reviews site:trustpilot.com`,
    `${brandGuess} reviews site:google.com/maps`,
    `${brandGuess} reviews site:yelp.com`,
    // generic web fallback
    `${brandGuess} reviews`
  ];

  const sources: ReviewSource[] = [];
  let totalW = 0, sum = 0, count = 0, pkg = 0;

  for (const q of queries) {
    const items = await cseSearch(q, 5);
    await sleep(250);

    for (const it of items) {
      const rating = parseRating(it.snippet);
      const c = parseCount(it.snippet);
      const hits = packagingHits(it.snippet + " " + it.title);

      let source: ReviewSource["source"] = "web";
      if (/trustpilot\.com/i.test(it.link)) source = "trustpilot";
      else if (/google\./i.test(it.link) && /maps/.test(it.link)) source = "google";
      else if (/yelp\.com/i.test(it.link)) source = "yelp";

      sources.push({ source, url: it.link, rating, count: c, pkgMentions: hits });

      if (typeof rating === "number") {
        const w = Math.max(1, Math.min(10, (c ?? 1) ** 0.25)); // softly weight by count
        sum += rating * w;
        totalW += w;
      }
      if (typeof c === "number") count += c;
      pkg += hits;
    }
  }

  if (!sources.length) return null;

  const rating = totalW > 0 ? (sum / totalW) : undefined;
  const out: ReviewSignals = {
    domain: host,
    rating,
    count: count || undefined,
    pkgMentions: pkg || undefined,
    updatedAt: new Date().toISOString(),
    sources
  };
  return out;
}
