// Free-mode “advertiser discovery”: we don’t scrape paid APIs.
// We emit *proof links* you (or the vendor) can click to verify current ads.

export type AdvertiserFreeHit = {
  domain: string;                 // normalized host (e.g., "liquiddeath.com")
  source: 'meta' | 'google';      // library we point to
  proofUrl: string;               // click this to verify
  adCount?: number | null;        // unknown in free mode
  lastSeen?: string | null;       // unknown in free mode
};

const DEFAULT_REGION = 'US';

function normHost(s?: string): string {
  if (!s) return '';
  let h = s.trim().toLowerCase();
  if (!h) return '';
  h = h.replace(/^https?:\/\//, '');
  const i = h.indexOf('/');
  if (i > -1) h = h.slice(0, i);
  return h;
}

function proofLinks(domain: string, region = DEFAULT_REGION): AdvertiserFreeHit[] {
  const host = normHost(domain);
  if (!host) return [];
  const enc = encodeURIComponent(host);
  return [
    // Meta Ad Library search (free, interactive)
    {
      domain: host,
      source: 'meta',
      proofUrl: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(region)}&q=${enc}`,
    },
    // Google Ads Transparency Center – Google search that lands on advertiser pages
    {
      domain: host,
      source: 'google',
      proofUrl: `https://www.google.com/search?q=site:adstransparency.google.com%20${enc}`,
    },
  ];
}

// Main entry — NO top-level execution anymore.
export async function findAdvertisersFree(opts: {
  seedDomains?: string[];
  industries?: string[];          // not used yet (future keyword boost)
  regions?: string[];
}): Promise<AdvertiserFreeHit[]> {
  const region = (opts.regions?.[0] || DEFAULT_REGION).toUpperCase();
  const seeds = (opts.seedDomains || []).map(normHost).filter(Boolean);

  const out: AdvertiserFreeHit[] = [];
  for (const d of seeds) out.push(...proofLinks(d, region));

  // No network calls in free path; return instantly.
  return out;
}
