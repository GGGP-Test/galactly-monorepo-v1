/**
 * reviews.ts
 * Free-tier safe packaging-complaint signal collector (Trustpilot + Reddit).
 * - NO Google scraping.
 * - Returns normalized hits with packaging lexicon matches.
 */

export type ReviewHit = {
  url: string;
  title: string;
  snippet: string;
  source: 'trustpilot'|'reddit';
  terms: string[];        // matched packaging terms
  ratingApprox?: number;  // 1..5 when known
  severity: number;       // 0..1 (used to bump heat)
};

const PACKAGING_LEXICON = [
  // damage/strength
  'box crushed','crushed box','dented box','carton dent','carton crushed',
  'bottle broke','broken bottle','jar cracked','cap loose','seal broken','seal failed',
  'leaking','leak','spillage','spilled','pouch leaking','burst','rupture','tearing','tear',
  'weak shrink','shrink wrap','film tear','film ripped','seal integrity','tamper seal',
  // fulfillment/quantity/pack
  'wrong pack','underfilled','overfilled','case pack','moq','minimum order quantity',
  'tray pack','sleeve','corrugate','corrugated','carton','mailer',
  // labeling/print
  'label misprint','label peeled','smudged label','ink rub-off','mislabel',
  // misc
  'packaging damaged','damaged packaging','poor packaging','bad packaging','packaging issue'
].map(s => s.toLowerCase());

/** utility: normalize domain to bare host */
function toHost(input: string): string {
  try {
    let s = input.trim();
    s = s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    s = s.replace(/^www\./i, '');
    return s;
  } catch { return input; }
}

/** utility: timeout fetch */
async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'GalactlyBot/1.0 (+https://galactly.app; contact: support@galactly.app)'
      }
    } as any);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

/** lexicon match */
function matchTerms(text: string): string[] {
  const lo = text.toLowerCase();
  const set = new Set<string>();
  for (const term of PACKAGING_LEXICON) {
    if (lo.includes(term)) set.add(term);
  }
  return Array.from(set);
}

/** simple severity score from terms + coarse heuristics */
function severityFrom(terms: string[], rating?: number, votes?: number): number {
  let s = Math.min(1, terms.length * 0.18); // more distinct terms -> higher
  if (typeof rating === 'number') s += (3 - Math.min(3, rating)) * 0.08; // worse rating -> bump
  if (typeof votes === 'number') s += Math.min(0.2, Math.log10(1 + Math.max(0, votes)) * 0.08);
  return Math.max(0, Math.min(1, s));
}

/** ---- Trustpilot scraper (public HTML) ----
 * We attempt https://www.trustpilot.com/review/<host> first,
 * then fallback to .co.uk if .com 404s.
 */
async function scanTrustpilot(host: string): Promise<ReviewHit[]> {
  const h = toHost(host);
  const urls = [
    `https://www.trustpilot.com/review/${encodeURIComponent(h)}`,
    `https://www.trustpilot.co.uk/review/${encodeURIComponent(h)}`
  ];
  for (const url of urls) {
    try {
      const html = await fetchText(url, 9000);
      // coarse parse: each review card usually has data-service-review-text-typography / review-content__text
      const cards = Array.from(html.matchAll(/<article[^>]+?review-card[^>]*>([\s\S]*?)<\/article>/gi));
      if (!cards.length) continue;

      const hits: ReviewHit[] = [];
      for (const m of cards) {
        const block = m[1] || '';
        const title = (block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '')
          .replace(/<[^>]+>/g,'')
          .trim();
        const body = (block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '')
          .replace(/<[^>]+>/g,'')
          .trim();
        const text = `${title} ${body}`.trim();
        const terms = matchTerms(text);
        if (!terms.length) continue;

        // rating approx: data-service-review-rating="X" or aria-label="Rated X out of 5"
        let rating: number | undefined = undefined;
        const m1 = block.match(/data-service-review-rating="([0-9.]+)"/i)?.[1];
        const m2 = block.match(/Rated\s+([0-9.]+)\s+out of 5/i)?.[1];
        if (m1) rating = Number(m1);
        else if (m2) rating = Number(m2);

        hits.push({
          url,
          title: title || 'Trustpilot review',
          snippet: body || text.slice(0, 200),
          source: 'trustpilot',
          terms,
          ratingApprox: rating,
          severity: severityFrom(terms, rating)
        });
        if (hits.length >= 10) break; // cap
      }
      if (hits.length) return hits;
    } catch {
      // try next TLD
    }
  }
  return [];
}

/** ---- Reddit search (JSON API) ---- */
async function scanReddit(hostOrBrand: string): Promise<ReviewHit[]> {
  const q = `${toHost(hostOrBrand)} packaging OR box OR bottle OR label OR pouch`;
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=15`;
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'GalactlyBot/1.0' }
    } as any);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j: any = await r.json();
    const out: ReviewHit[] = [];
    for (const c of (j?.data?.children || [])) {
      const d = c?.data || {};
      const title = String(d.title || '');
      const body = String(d.selftext || '');
      const text = `${title}\n${body}`;
      const terms = matchTerms(text);
      if (!terms.length) continue;
      const votes = Number(d.ups || d.score || 0);
      out.push({
        url: `https://www.reddit.com${d.permalink || ''}`,
        title: title || 'Reddit post',
        snippet: (body || title).slice(0, 220),
        source: 'reddit',
        terms,
        ratingApprox: undefined,
        severity: severityFrom(terms, undefined, votes)
      });
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Public API — scanReviews(host)
 * Usage: const hits = await scanReviews('brand.com')
 */
export async function scanReviews(host: string): Promise<ReviewHit[]> {
  const [tp, rd] = await Promise.allSettled([
    scanTrustpilot(host),
    scanReddit(host)
  ]);
  const a: ReviewHit[] = [];
  if (tp.status === 'fulfilled' && Array.isArray(tp.value)) a.push(...tp.value);
  if (rd.status === 'fulfilled' && Array.isArray(rd.value)) a.push(...rd.value);
  // de-dup by URL
  const seen = new Set<string>();
  return a.filter(h => {
    if (!h.url) return false;
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  }).slice(0, 12);
}
