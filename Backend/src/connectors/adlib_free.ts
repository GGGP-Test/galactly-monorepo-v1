// Backend/src/connectors/adlib_free.ts
// Free advertiser "proof" links (no API keys):
//  - Meta Ads Library (search view): https://www.facebook.com/ads/library/?q=<query>&country=<CC>&active_status=all
//  - Google Ads Transparency Center (search view): https://adstransparency.google.com/advertiser?search=<query>
//
// We return canonical proof URLs per buyer domain and (optionally) brand name.
// We do a fast HEAD/GET to confirm 200 and then emit a record you can insert as a lead.

type Adv = {
  domain: string;
  brand?: string;
  source: 'meta' | 'google';
  proofUrl: string;
  lastSeen: string;            // ISO now (we can’t scrape dates for free)
  adCount?: number | null;     // unknown in free-mode
};

const CC = (process.env.ADS_COUNTRY || 'US').toUpperCase();

async function ok(url: string): Promise<boolean> {
  try {
    // Node 20 global fetch
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'GalactlyBot/0.1' } });
    return r.ok;
  } catch { return false; }
}

function cleanHost(x: string): string {
  return x.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
}

export async function findAdvertisersFree(
  buyers: string[] = [],
  opts?: { brands?: string[]; cc?: string }
): Promise<Adv[]> {
  const cc = (opts?.cc || CC).toUpperCase();
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const out: Adv[] = [];

  // build simple query tokens from domains/brands
  const queries: { q: string; brand?: string; domain?: string }[] = [];
  for (const raw of buyers) {
    const host = cleanHost(raw);
    if (!host || !host.includes('.')) continue;
    queries.push({ q: host, domain: host });
  }
  for (const b of (opts?.brands || [])) {
    const q = (b || '').trim();
    if (q) queries.push({ q, brand: q });
  }

  // generate candidate proof URLs and keep those that 200
  for (const { q, domain, brand } of queries) {
    // Meta Ads Library search
    const meta = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(cc)}&q=${encodeURIComponent(q)}`;
    if (!seen.has(meta) && await ok(meta)) {
      seen.add(meta);
      out.push({ domain: domain || q, brand, source: 'meta', proofUrl: meta, lastSeen: now, adCount: null });
    }
    // Google Ads Transparency Center search
    const g = `https://adstransparency.google.com/advertiser?search=${encodeURIComponent(q)}`;
    if (!seen.has(g) && await ok(g)) {
      seen.add(g);
      out.push({ domain: domain || q, brand, source: 'google', proofUrl: g, lastSeen: now, adCount: null });
    }
  }

  // Keep small (free-tier friendly)
  return out.slice(0, Number(process.env.FIND_MAX_PROOFS || 40));
}
