

function base(){
  const b = process.env.RSSHUB_BASE?.replace(/\/$/, '') || '';
  if(!b) throw new Error('[rssHub] RSSHUB_BASE not set');
  return b;
}
function key(){
  const k = process.env.RSSHUB_KEY || '';
  if(!k) throw new Error('[rssHub] RSSHUB_KEY not set');
  return k;
}
function u(path: string, extraParams: string = ''){
  const sep = path.includes('?') ? '&' : '?';
  return `${base()}${path}${sep}key=${encodeURIComponent(key())}${extraParams}`;
}

// Utility to URL-encode a keyword once
function kq(s: string){ return encodeURIComponent(s); }

// ---------------- Curated Catalog (platform-specific) ----------------
// Notes:
// - Focus on *buyers (demand signals)* via keyword routes where possible.
// - Sellers (suppliers) are mostly brand/industry accounts: useful for trend
//   monitoring; less for hot RFQs, but still valuable for outreach lists.
// - We add conservative filters in query string where supported by RSSHub
//   (e.g., filter_title, filter_description, limit).

// Bluesky: keyword search (great for realtime buyer language)
function blueskyKeywords(){
  const kw = [
    'need packaging',
    'rfq packaging',
    'request for quote packaging',
    'quote for boxes',
    'looking for packaging supplier',
    'custom boxes quote',
    'stand up pouch quote',
    'corrugated boxes quote',
    'labels quote',
    'ghs labels quote',
    'ispm-15 pallets',
  ];
  return kw.map(q => u(`/bsky/keyword/${kq(q)}`, `&limit=40&filter_title=rfq|quote|need|supplier`));
}

// Threads: user timelines (no public keyword route; follow relevant orgs)
function threadsUsers(){
  const users = [
    'packagingeurope',
    'packagingdigest',
    'thedieline',
    'smitherspira',
    'uline',
    'packhelp',
  ];
  return users.map(h => u(`/threads/${h}`, `&limit=20`));
}

// Instagram (public mirrors) via Picnob / Picuki (strict anti-crawling; best-effort)
function instagramMirrors(){
  const ids = [
    'packagingeurope',
    'packagingdigest',
    'thedieline',
    'uline',
    'packhelp',
  ];
  return [
    ...ids.map(id => u(`/picnob/user/${id}`, `&limit=20`)),
    ...ids.map(id => u(`/picuki/profile/${id}`, `&limit=20`)),
  ];
}

// YouTube: industry channels (news, case studies, demand spikes)
function youtubeIndustry(){
  const users = [
    '@PackagingEurope',
    '@PackagingWorld',
    '@SmithersPira',
    '@EskoSolutions',
    '@TheDielineOfficial',
  ];
  return users.map(un => u(`/youtube/user/${encodeURIComponent(un)}`, `&limit=20`));
}

// GitHub (optional; BOM/specs from hardware brands)
function githubSearch(){
  return [u(`/github/search/${kq('packaging rfq')}/bestmatch/desc`, `&limit=20`)];
}

// Combine everything into one list
function curatedRssHubFeeds(){
  return [
    ...blueskyKeywords(),
    ...threadsUsers(),
    ...instagramMirrors(),
    ...youtubeIndustry(),
    ...githubSearch(),
  ];
}

// ---------------- Public-native feeds (not via RSSHub) ----------------
// Provide alongside, so caller can also ingest these in FEEDS_NATIVE.
export function curatedNativeFeeds(){
  return [
    // Reddit searches / subs
    'https://www.reddit.com/search.rss?q=need+packaging&sort=new',
    'https://www.reddit.com/search.rss?q=%22request+for+quote%22+packaging&sort=new',
    'https://www.reddit.com/r/packaging/new.rss',
    'https://www.reddit.com/r/smallbusiness/search.rss?q=packaging&restrict_sr=1&sort=new',

    // Google News searches (intent terms)
    'https://news.google.com/rss/search?q=%22need%20packaging%22%20OR%20(%22request%20for%20quote%22%20packaging)%20OR%20(RFQ%20packaging)&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=%22custom%20boxes%22%20OR%20%22stand%20up%20pouch%22%20OR%20%22packaging%20supplier%22&hl=en-US&gl=US&ceid=US:en',

    // YouTube channel native feeds (if you prefer not to use RSSHub user routes)
    // 'https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxx',
  ];
}

// ---------------- Public API ----------------
export function loadRssHubFeeds(): string[]{
  const envList = (process.env.RSSHUB_FEEDS || '')
    .split(',')
    .map(s=>s.trim())
    .filter(Boolean);
  if(envList.length) return envList;
  // build curated defaults using base+key
  return curatedRssHubFeeds();
}

export function listCuratedRssHubFeeds(): string[]{
  return curatedRssHubFeeds();
}
