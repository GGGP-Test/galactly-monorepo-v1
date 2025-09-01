// Backend/src/connectors/reviews.ts
// Public-review probe → finds packaging-related complaints via Google CSE
// Env: GOOGLE_API_KEY + (REVIEW_CX | GOOGLE_CX_REVIEWS | GOOGLE_CX_1)

type Hit = { url: string; title: string; snippet: string };
export type ReviewHit = Hit & {
  source: string;            // trustpilot | yelp | google | sitejabber | amazon | etc.
  ratingApprox?: number;     // 1..5 if we can infer
  terms: string[];           // matched packaging terms
  severity: number;          // 0..1 weighted by terms & rating
};

const PACKAGING_TERMS = [
  // categories keep it simple & extensible
  'packag', 'box', 'carton', 'case', 'pallet', 'shrink', 'stretch', 'wrap', 'film',
  'bottle', 'can', 'jar', 'lid', 'cap', 'seal', 'tamper', 'label', 'expiry', 'barcode',
  // complaints
  'damaged', 'crushed', 'dented', 'leak', 'leaking', 'spilled', 'broken', 'open',
  'poorly packed', 'bad packaging', 'arrived warm', 'melted', 'not sealed'
];

const REVIEW_SITES = [
  // keep a tight, review-focused set; your CSE should whitelist these
  'trustpilot.com', 'sitejabber.com', 'yelp.com', 'google.com/maps', 'google.com/search',
  'reddit.com', 'amazon.com', 'bestbuy.com', 'walmart.com', 'target.com'
];

function brandFromHost(host: string) {
  const h = (host || '').toLowerCase().replace(/^www\./,'');
  const parts = h.split('.');
  if (parts.length <= 2) return parts[0];
  // take the second-level token (e.g. "liquiddeath" from liquiddeath.com)
  return parts[parts.length - 2];
}

function scoreTerms(text: string) {
  const lower = text.toLowerCase();
  const matched = PACKAGING_TERMS.filter(k => lower.includes(k));
  // weight: unique terms / total + emphasis for hard negatives
  const hard = ['leak', 'leaking', 'spilled', 'broken', 'crushed', 'dented', 'not sealed'];
  const hardHits = hard.filter(h => lower.includes(h)).length;
  const sev = Math.min(1, (matched.length / 6) + hardHits * 0.15);
  return { matched, sev };
}

function inferRating(text: string) {
  // Try: "3.2 stars", "3 out of 5", "★★★☆☆", "3-star"
  const t = text.replace(/\s+/g, ' ');
  const num = /(\d(?:\.\d)?)\s*(?:out of\s*)?5\s*stars?/i.exec(t)?.[1]
           || /(\d(?:\.\d)?)\s*stars?/i.exec(t)?.[1];
  if (num) return Math.max(1, Math.min(5, Number(num)));
  const stars = (t.match(/★/g) || []).length || 0;
  if (stars >= 1 && stars <= 5) return stars;
  const word = /(one|two|three|four|five)[-\s]?star/i.exec(t)?.[1];
  const map: any = { one:1, two:2, three:3, four:4, five:5 };
  return word ? map[word.toLowerCase()] : undefined;
}

async function cse(query: string, siteFilter?: string, num = 5): Promise<Hit[]> {
  const key = process.env.GOOGLE_API_KEY;
  const cx  = process.env.REVIEW_CX || process.env.GOOGLE_CX_REVIEWS || process.env.GOOGLE_CX_1;
  if (!key || !cx) return [];
  const q = siteFilter ? `${query} site:${siteFilter}` : query;
  const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=${num}&safe=off`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const j = await r.json();
  const items = Array.isArray(j.items) ? j.items : [];
  return items.map((it: any) => ({ url: it.link, title: it.title, snippet: it.snippet || '' }));
}

function sourceFromUrl(u: string) {
  try { const host = new URL(u).hostname.replace(/^www\./,''); return host.split('.').slice(-2).join('.'); }
  catch { return 'web'; }
}

export async function scanReviews(host: string): Promise<ReviewHit[]> {
  const brand = brandFromHost(host);
  if (!brand) return [];

  // Build compact query set; we’ll ask CSE to search review domains
  const baseQueries = [
    `${brand} reviews packaging`,
    `${brand} review damaged packaging`,
    `${brand} leaking bottle review`,
    `${brand} dented can review`,
    `${brand} poor packaging`,
  ];

  const out: ReviewHit[] = [];
  for (const q of baseQueries) {
    for (const site of REVIEW_SITES) {
      const hits = await cse(q, site, 5);
      for (const h of hits) {
        const text = `${h.title} ${h.snippet}`;
        const { matched, sev } = scoreTerms(text);
        if (!matched.length) continue;               // only keep packaging-relevant
        const rating = inferRating(text);
        // we prefer keeping 1–3.5★ or unrated but clearly negative text
        const okByRating = (rating === undefined) ? true : (rating <= 3.5);
        if (!okByRating) continue;
        out.push({
          ...h,
          source: sourceFromUrl(h.url),
          ratingApprox: rating,
          terms: matched.slice(0, 6),
          severity: sev
        });
      }
    }
  }

  // De-dup by URL and prefer strongest severity
  const best = new Map<string, ReviewHit>();
  for (const h of out) {
    const prev = best.get(h.url);
    if (!prev || (h.severity > prev.severity)) best.set(h.url, h);
  }
  return Array.from(best.values()).slice(0, 12);
}
