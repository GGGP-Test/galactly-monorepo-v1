// Backend/src/connectors/adlib_free.ts
// Free, no-API helper that turns buyer domains into "proof" links on public ad libraries.

export type AdvertiserProof = {
  domain: string;           // buyer domain, e.g. "olipop.com"
  source: 'meta' | 'google';
  proofUrl: string;         // deep link to Ads Library / Transparency Center
  adCount?: number;         // unknown on free path
  lastSeen?: string;        // now (we're synthesizing the link)
};

function toHost(x: string): string {
  try {
    const s = x.trim();
    const u = s.startsWith('http') ? new URL(s) : new URL(`https://${s}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return x.replace(/^https?:\/\//,'').replace(/\/.*$/,'').toLowerCase(); }
}

function brandKeywordFromHost(host: string): string {
  // crude brand token: take the 2nd-level label ("liquiddeath" from "liquiddeath.com")
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return host.replace(/\W+/g, ' ');
}

function metaLinkFor(host: string, country = 'US'): string {
  const q = encodeURIComponent(brandKeywordFromHost(host));
  // "all ads" search for brand keyword
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&q=${q}`;
}

function googleLinkFor(host: string, country = 'US'): string {
  const q = encodeURIComponent(brandKeywordFromHost(host));
  // Google Ads Transparency Center search by brand keyword (site filters are spotty)
  return `https://adstransparency.google.com/advertiser/${country}/search?q=${q}`;
}

export async function findAdvertisersFree(input: {
  buyers?: string[];
  industries?: string[];      // unused in free mode, kept for parity
  regions?: string[];         // we only use first (default US)
}): Promise<AdvertiserProof[]> {
  const buyers = (input?.buyers || []).map(toHost).filter(Boolean);
  const country = (input?.regions && input.regions[0]) || 'US';
  const proofs: AdvertiserProof[] = [];
  const seen = new Set<string>();

  for (const host of buyers) {
    const meta = metaLinkFor(host, country);
    const goo  = googleLinkFor(host, country);

    const pair: AdvertiserProof[] = [
      { domain: host, source: 'meta',   proofUrl: meta,   lastSeen: new Date().toISOString() },
      { domain: host, source: 'google', proofUrl: goo,    lastSeen: new Date().toISOString() },
    ];

    for (const p of pair) {
      if (!seen.has(p.proofUrl)) { proofs.push(p); seen.add(p.proofUrl); }
    }
  }

  return proofs;
}
