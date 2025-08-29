// Free pixel signal: detect Meta/Google/TikTok/LinkedIn/etc. pixels on homepage
// Usage: const hits = await scanPixels('example.com')
export type PixelHit = { url: string; network: string; id?: string; proof?: string };

async function get(url: string): Promise<string|null> {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'GalactlyBot/0.1 (+https://galactly.dev)' } });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return null;
    const html = await r.text();
    return html.slice(0, 250_000);
  } catch { return null; }
}

export async function scanPixels(domain: string): Promise<PixelHit[]> {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/+$/,'');
  const url = `https://${host}/`;
  const html = await get(url);
  if (!html) return [];
  const hits: PixelHit[] = [];
  const H = html;

  // Meta Pixel
  if (/connect\.facebook\.net\/.+\/fbevents\.js/i.test(H) || /fbq\(['"]init['"],\s*['"](\d+)['"]\)/i.test(H)) {
    const m = H.match(/fbq\(['"]init['"],\s*['"](\d+)['"]\)/i);
    hits.push({ url, network: 'meta', id: m?.[1], proof: 'fbq/fbevents.js' });
  }

  // Google Ads (AW-xxxxx) via gtag config
  const gads = [...H.matchAll(/gtag\(\s*['"]config['"]\s*,\s*['"](AW-\d+)['"]\s*\)/gi)];
  if (gads.length) hits.push({ url, network: 'google_ads', id: gads[0][1], proof: 'gtag AW' });

  // TikTok
  if (/analytics\.tiktok\.com\/i18n\/pixel\/events\.js/i.test(H) || /ttq\.load\(/i.test(H)) {
    hits.push({ url, network: 'tiktok', proof: 'ttq pixel' });
  }

  // LinkedIn
  if (/px\.ads\.linkedin\.com|lintrk\(/i.test(H)) {
    hits.push({ url, network: 'linkedin', proof: 'insight tag' });
  }

  // Pinterest
  if (/s\.pinimg\.com\/ct\/core\.js|pintrk\(/i.test(H)) {
    hits.push({ url, network: 'pinterest', proof: 'pintrk' });
  }

  // Snap
  if (/sc-static\.net\/scevent\.min\.js|snaptr\(/i.test(H)) {
    hits.push({ url, network: 'snap', proof: 'snaptr' });
  }

  // Klaviyo (often with paid stack)
  if (/static\.klaviyo\.com\/onsite\/js\/klaviyo\.js/i.test(H)) {
    hits.push({ url, network: 'klaviyo', proof: 'klaviyo onsite' });
  }

  return hits;
}
