
type FindOpts = {
  keywords: string[];      // e.g. ["gummies","beverage","snack","beauty"]
  regions?: string[];      // e.g. ["US","CA"]
  limit?: number;          // cap final merged list
};

export type AdvertiserHit = {
  domain: string;
  brand?: string;
  source: 'meta' | 'google';
  proofUrl: string;
  adCount: number;
  lastSeen: string; // ISO
};

const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const META_ACTOR = process.env.APIFY_META_ACTOR_ID || 'apify~facebook-ads-library-scraper';
const GADS_ACTOR = process.env.APIFY_GADS_ACTOR_ID || ''; // leave blank if you don’t have one
const LOOKBACK_D = Number(process.env.ADLIB_LOOKBACK_DAYS || 14);
const MAX_OUT = Number(process.env.ADLIB_MAX_RESULTS || 80);

function daysAgoIso(d: number) {
  const t = Date.now() - d * 86400000;
  return new Date(t).toISOString();
}
function host(u: string) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }
function normDomain(s: string) {
  let h = s.trim().toLowerCase();
  if (!h) return '';
  if (!h.includes('.') && h.includes(' ')) return ''; // “Acme Inc” → ignore
  // handle “www.domain.com/..”, “http(s)://”
  try { h = new URL(/^https?:\/\//i.test(h) ? h : 'https://' + h).hostname.toLowerCase(); } catch {}
  h = h.replace(/^www\./, '');
  return h;
}

async function apifyRunGetItems(actorId: string, input: any): Promise<any[]> {
  if (!APIFY_TOKEN || !actorId) return [];
  // Use run-sync-get-dataset-items to receive items directly
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) return [];
  return await r.json().catch(() => []);
}

function withinLookback(iso?: string | null) {
  if (!iso) return false;
  try {
    const t = new Date(iso).getTime();
    return t >= Date.now() - LOOKBACK_D * 86400000;
  } catch { return false; }
}

export async function findAdvertisers(opts: FindOpts): Promise<AdvertiserHit[]> {
  const { keywords, regions = ['US', 'CA'], limit = MAX_OUT } = opts || {};
  const after = daysAgoIso(LOOKBACK_D);

  const out: AdvertiserHit[] = [];
  const seen = new Map<string, AdvertiserHit>(); // key by domain+source

  // ---- Meta Ads Library (via Apify actor) ----
  // Common inputs the community actors accept:
  //   searchTerms: [], countries: ["US","CA"], adActiveStatus: "ACTIVE", adDeliveryDateFrom: after
  try {
    const items = await apifyRunGetItems(META_ACTOR, {
      searchTerms: keywords && keywords.length ? keywords : ['packaging', 'boxes', 'labels'],
      countries: regions,
      adActiveStatus: 'ACTIVE',
      adDeliveryDateFrom: after,
      maxConcurrency: 2,
    });

    for (const it of items || []) {
      // actor schemas vary; try to extract best we can
      const pageUrl = it.pageUrl || it.page_url || it.advertiserUrl || '';
      const website = it.website || it.advertiserWebsite || '';
      const proof = it.adLink || it.permalink || it.url || pageUrl || website || '';
      const last = it.lastSeen || it.adSnapshotDate || it.publishedAt || it.updatedAt || it.scrapedAt || null;
      const brand = it.pageName || it.advertiserName || it.name || null;

      const d = normDomain(website || pageUrl || proof);
      if (!d) continue;
      if (last && !withinLookback(last)) continue;

      const key = d + '|meta';
      const prev = seen.get(key);
      const hit: AdvertiserHit = {
        domain: d,
        brand: brand || undefined,
        source: 'meta',
        proofUrl: proof || `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(brand || d)}`,
        adCount: Number(it.adCount || it.adsCount || 1),
        lastSeen: (last && new Date(last).toISOString()) || new Date().toISOString(),
      };
      if (!prev || hit.adCount > prev.adCount) seen.set(key, hit);
    }
  } catch { /* ignore meta errors */ }

  // ---- Google Ads Transparency Center (optional) ----
  if (GADS_ACTOR) {
    try {
      const items = await apifyRunGetItems(GADS_ACTOR, {
        queries: keywords && keywords.length ? keywords : ['packaging', 'boxes', 'labels'],
        countries: regions,
        since: after,
        maxConcurrency: 1,
      });

      for (const it of items || []) {
        const advSite = it.advertiserWebsite || it.website || '';
        const proof = it.adUrl || it.proofUrl || it.detailsUrl || '';
        const last = it.lastSeen || it.updatedAt || it.scrapedAt || null;
        const brand = it.advertiserName || it.name || null;

        const d = normDomain(advSite || proof);
        if (!d) continue;
        if (last && !withinLookback(last)) continue;

        const key = d + '|google';
        const prev = seen.get(key);
        const hit: AdvertiserHit = {
          domain: d,
          brand: brand || undefined,
          source: 'google',
          proofUrl: proof || `https://transparencyreport.google.com/political-ads/advertiser/${encodeURIComponent(brand || d)}`,
          adCount: Number(it.adCount || 1),
          lastSeen: (last && new Date(last).toISOString()) || new Date().toISOString(),
        };
        if (!prev || hit.adCount > prev.adCount) seen.set(key, hit);
      }
    } catch { /* ignore google errors */ }
  }

  // Merge + rank
  for (const v of seen.values()) out.push(v);
  out.sort((a, b) => {
    const aa = Date.parse(a.lastSeen || '') || 0;
    const bb = Date.parse(b.lastSeen || '') || 0;
    // favor recency then adCount
    if (bb !== aa) return bb - aa;
    return (b.adCount || 0) - (a.adCount || 0);
  });

  return out.slice(0, limit);
}

// Tiny helper to map advertisers to distinct domains (for downstream scans)
export function advertisersToDomains(hits: AdvertiserHit[]): string[] {
  const s = new Set<string>();
  for (const h of hits) if (h.domain) s.add(h.domain);
  return Array.from(s);
}
