
export type AdProof = {
  domain: string;
  source: 'meta' | 'google';
  proofUrl: string;
  adCount?: number;    // unknown in free mode
  lastSeen?: string;   // "recent" in free mode
};

function normHost(s?: string) {
  if (!s) return ''; let h = s.trim();
  if (!h) return '';
  h = h.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const slash = h.indexOf('/');
  return slash > 0 ? h.slice(0, slash) : h;
}

function encode(q: string) { return encodeURIComponent(q); }

function buildMetaUrl(host: string, country: string) {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(country)}&q=${encode(host)}`;
}

function buildGoogleUrl(host: string) {
  // Google Ads Transparency doesn’t let us filter by advertiser in URL reliably,
  // so we use a site: search that lands on the ads transparency host with the domain.
  const q = `site:adstransparency.google.com ${host}`;
  return `https://www.google.com/search?q=${encode(q)}`;
}

export async function findAdvertisersFree(params: {
  industries?: string[];   // currently unused (reserved for keyword expansions)
  regions?: string[];      // ISO‑2 like ["US","CA"]; default from env
  seedDomains?: string[];  // user seed + discovered
}): Promise<AdProof[]> {
  const regions = (process.env.ADLIB_FREE_META_COUNTRIES || 'US')
    .split(',').map(s => s.trim()).filter(Boolean);

  const out: AdProof[] = [];
  const seen = new Set<string>();
  const domains = Array.from(new Set((params.seedDomains || []).map(normHost).filter(Boolean)));

  for (const host of domains) {
    // Meta per region
    for (const c of regions) {
      const url = buildMetaUrl(host, c);
      if (!seen.has(url)) { seen.add(url); out.push({ domain: host, source: 'meta', proofUrl: url, lastSeen: 'recent' }); }
    }
    // Google (single)
    const g = buildGoogleUrl(host);
    if (!seen.has(g)) { seen.add(g); out.push({ domain: host, source: 'google', proofUrl: g, lastSeen: 'recent' }); }
  }
  return out;
}
