// connectors/adlib_free.ts  (snippet you add where you push results)
function proofLinks(host: string, country='US'){
  const q = encodeURIComponent(host.replace(/^www\./,''));
  return [
    { url: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${country}&q=${q}`, src: 'meta_ad_library' },
    { url: `https://adstransparency.google.com/advertiser?q=${q}`, src: 'google_ads_transparency' }
  ];
}

// When you process each candidate domain:
for (const p of proofLinks(host, 'US')) {
  out.push({
    domain: host,
    source: p.src,
    proofUrl: p.url,
    adCount: null,
    lastSeen: null
  });
}
