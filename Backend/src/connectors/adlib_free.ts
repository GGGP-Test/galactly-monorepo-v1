// Lightweight, free "advertiser discovery" helper.
// No paid APIs. We just construct public search/proof URLs for ad libraries.

type Opts = {
  regions?: string[];         // e.g., ['US']
  industries?: string[];      // unused for now (future keyword bias)
  max?: number;               // cap on returned items
};

export type AdvertiserHit = {
  domain: string;
  source: 'meta' | 'google';
  proofUrl: string;           // always present
  adCount?: number | null;    // unknown in free mode
  lastSeen?: string | null;   // unknown in free mode
};

/** normalize host → example.com */
function cleanHost(s: string): string {
  const t = (s || '').trim().toLowerCase();
  try {
    const u = new URL(t.includes('://') ? t : `https://${t}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return t.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

/** Build a Meta Ads Library search URL (works as a proof link even without an API). */
function metaProof(domain: string, country: string) {
  // Country must be a 2-letter code Meta accepts (fallback US)
  const cc = (country || 'US').toUpperCase();
  // q supports brand/page text or domain; using domain keeps it generic and free
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(
    cc
  )}&q=${encodeURIComponent(domain)}`;
}

/** Build a Google Ads Transparency Center search URL (free, public). */
function googleProof(domain: string, country: string) {
  // The ATC is SPA-based; this search URL still opens the correct view for humans
  const cc = (country || 'US').toUpperCase();
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(
    domain
  )}?region=${encodeURIComponent(cc)}&hl=en-US`;
}

/**
 * Free mode:
 *  - If the caller passes buyers, we use those directly.
 *  - Otherwise we return [] (we’re not crawling at all in free mode).
 * Each buyer yields 2 hits (meta + google) with proof URLs you can click.
 */
export async function findAdvertisersFree(
  buyers: string[] | undefined,
  opts?: Opts
): Promise<AdvertiserHit[]> {
  const max = Math.max(1, Number(opts?.max ?? 50));
  const region = (opts?.regions && opts?.regions[0]) || 'US';

  const domains = (buyers || [])
    .map(cleanHost)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .slice(0, max);

  const out: AdvertiserHit[] = [];
  for (const d of domains) {
    // Always include at least one proof per network
    out.push({
      domain: d,
      source: 'meta',
      proofUrl: metaProof(d, region),
      adCount: null,
      lastSeen: null,
    });
    out.push({
      domain: d,
      source: 'google',
      proofUrl: googleProof(d, region),
      adCount: null,
      lastSeen: null,
    });
  }
  return out;
}
