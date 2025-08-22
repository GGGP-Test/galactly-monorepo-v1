/*
  feeds.expand.ts — generate BIG native & RSSHub feed lists for packaging lead intel

  Usage (locally):
    npm i -D ts-node typescript
    node --loader ts-node/esm Backend/scripts/feeds.expand.ts \
      --out-native out/feeds_native.txt \
      --out-rsshub out/rsshub_feeds.txt \
      --rsshub-base https://<YOUR-RSSHUB-URL> \
      --rsshub-key  <YOUR_RSSHUB_KEY>

  Note:
  - If you omit --rsshub-base/--rsshub-key the RSSHub file will be small (only native-friendly).
  - This script is pure TS/Node. No external packages.
*/

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// -------- helpers --------
function enc(s: string) { return encodeURIComponent(s); }
function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }
function linesToFile(path: string, lines: string[]) {
  const out = uniq(lines.filter(Boolean)).join('\n') + '\n';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out, 'utf8');
}
function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : '';
}

const OUT_NATIVE = arg('--out-native') || 'generated/feeds_native.txt';
const OUT_RSSHUB = arg('--out-rsshub') || 'generated/rsshub_feeds.txt';
const RSSHUB_BASE = (arg('--rsshub-base') || '').replace(/\/$/, '');
const RSSHUB_KEY  = arg('--rsshub-key') || '';

function rh(path: string, extra = ''): string {
  if (!RSSHUB_BASE || !RSSHUB_KEY) return '';
  const sep = path.includes('?') ? '&' : '?';
  return `${RSSHUB_BASE}${path}${sep}key=${enc(RSSHUB_KEY)}${extra}`;
}

// -------- seed lexicons --------
const packagingKeywords = [
  'custom boxes', 'custom packaging', 'folding carton', 'corrugated boxes', 'mailer box',
  'rigid box', 'box inserts', 'blister packaging', 'clamshell packaging',
  'stand up pouch', 'spout pouch', 'flat pouch', 'laminate film', 'rollstock',
  'shrink sleeve labels', 'shrink labels', 'sleeve labels',
  'labels', 'thermal transfer labels', 'direct thermal labels', 'rfid labels', 'ghs labels',
  'poly mailers', 'poly bags', 'zipper bags', 'vacuum pouches',
  'glass jars', 'plastic jars', 'bottles', 'closures', 'caps',
  'ispm-15 crate', 'export crate', 'pallets', 'edge protectors'
];

const intentVerbs = [
  'need', 'looking for', 'sourcing', 'supplier', 'vendor', 'quote', 'rfq', 'request for quote', 'tender', 'bid'
];

// Craigslist metros (mix of US & CA)
const clCities = [
  'newyork', 'losangeles', 'sfbay', 'chicago', 'boston', 'seattle', 'sandiego', 'denver', 'dallas', 'austin',
  'houston', 'atlanta', 'phoenix', 'minneapolis', 'portland', 'miami', 'orlando', 'tampa', 'nashville', 'charlotte',
  'lasvegas', 'philadelphia', 'pittsburgh', 'dc', 'baltimore', 'raleigh', 'richmond', 'norfolk', 'columbus', 'cleveland',
  'cincinnati', 'stlouis', 'kansascity', 'oklahomacity', 'albuquerque', 'saltlakecity', 'boise', 'madison', 'milwaukee',
  // Canada
  'vancouver', 'victoria', 'calgary', 'edmonton', 'saskatoon', 'winnipeg', 'toronto', 'hamilton', 'ottawa', 'montreal', 'quebec'
];

const redditSubs = [
  'packaging', 'smallbusiness', 'Entrepreneur', 'startups', 'ecommerce', 'shopify', 'amazon', 'etsy', 'FBA',
  'soapmaking', 'Coffee', 'tea', 'baking', 'beer', 'wine', 'skincareaddiction', 'candlemaking', 'FoodBusiness',
  'nutrition', 'supplements', 'petbusiness', 'beautybiz', 'crafts', 'Cheesemaking', 'HotSauce'
];

const newsBrands = [
  'tradewheel.com/buyers', 'thomasnet.com', 'packagingdigest.com', 'packagingeurope.com',
  'thedieline.com', 'fooddive.com', 'beveragedaily.com', 'cosmeticsdesign.com'
];

const ebayKw = [
  'custom+boxes', 'folding+carton', 'corrugated+boxes', 'stand+up+pouch', 'spout+pouch', 'shrink+sleeve+labels',
  'thermal+transfer+labels', 'direct+thermal+labels', 'rfid+labels', 'ghs+labels', 'laminate+film', 'rollstock'
];

// Social handles for RSSHub (industry orgs / vendor brands)
const handles = {
  threads: [ 'packagingeurope', 'packagingdigest', 'thedieline', 'smitherspira', 'uline', 'packhelp' ],
  insta:   [ 'packagingeurope', 'packagingdigest', 'thedieline', 'uline', 'packhelp' ],
  youtube: [ '@PackagingEurope', '@PackagingWorld', '@SmithersPira', '@TheDielineOfficial' ]
};

// -------- generators --------
function genCraigslist(): string[] {
  const q = ['custom boxes','labels','stand up pouch','corrugated boxes','ispm-15 crate','export crate'];
  const out: string[] = [];
  for (const city of clCities) {
    for (const k of q) {
      out.push(`https://${city}.craigslist.org/search/sss?query=${enc(k)}&sort=date&format=rss`);
    }
  }
  return out;
}

function genEbay(): string[] {
  return ebayKw.map(k => `https://www.ebay.com/sch/i.html?_nkw=${k}&_sop=10&rt=nc&_rss=1`);
}

function genReddit(): string[] {
  const out: string[] = [];
  // sub new feeds
  for (const s of redditSubs) out.push(`https://www.reddit.com/r/${s}/new.rss`);
  // intent searches
  const q = [
    'need packaging', 'request for quote packaging', 'looking for packaging supplier',
    'custom boxes quote', 'stand up pouch supplier', 'labels quote'
  ];
  for (const query of q) out.push(`https://www.reddit.com/search.rss?q=${enc(query)}&sort=new`);
  return out;
}

function genNews(): string[] {
  const out: string[] = [];
  const combos: string[] = [];
  for (const v of intentVerbs) for (const k of packagingKeywords) combos.push(`${v} ${k}`);
  // Google News & Bing News
  for (const c of combos.slice(0, 300)) {
    out.push(`https://news.google.com/rss/search?q=${enc(c)}&hl=en-US&gl=US&ceid=US:en`);
    out.push(`https://www.bing.com/news/search?q=${enc(c)}&format=rss`);
  }
  // site-scoped
  for (const d of newsBrands) {
    out.push(`https://news.google.com/rss/search?q=site%3A${enc(d)}+${enc('packaging OR boxes OR labels OR pouch OR corrugated')}&hl=en-US&gl=US&ceid=US:en`);
  }
  return out;
}

function genYouTubeNative(): string[] {
  // If you know channel IDs, add here. Most of these require IDs; keep empty by default.
  return [];
}

function genRSSHub(): string[] {
  if (!RSSHUB_BASE || !RSSHUB_KEY) return [];
  const out: string[] = [];
  // Bluesky keyword streams
  const bskyKw = [ 'need packaging', 'rfq packaging', 'custom boxes quote', 'labels quote', 'stand up pouch supplier' ];
  for (const k of bskyKw) out.push(rh(`/bsky/keyword/${enc(k)}`, `&limit=40&filter_title=rfq|quote|need|supplier`));
  // Threads timelines
  for (const h of handles.threads) out.push(rh(`/threads/${h}`, `&limit=20`));
  // Instagram mirrors (picnob + picuki)
  for (const h of handles.insta) {
    out.push(rh(`/picnob/user/${h}`, `&limit=20`));
    out.push(rh(`/picuki/profile/${h}`, `&limit=20`));
  }
  // YouTube user routes
  for (const h of handles.youtube) out.push(rh(`/youtube/user/${enc(h)}`, `&limit=20`));
  // Github search (optional
  out.push(rh(`/github/search/${enc('packaging rfq')}/bestmatch/desc`, `&limit=20`));
  return out;
}

// -------- run --------
const nativeFeeds = uniq([
  ...genCraigslist(),
  ...genEbay(),
  ...genReddit(),
  ...genNews(),
  ...genYouTubeNative()
]);

const rsshubFeeds = uniq(genRSSHub());

linesToFile(OUT_NATIVE, nativeFeeds);
linesToFile(OUT_RSSHUB, rsshubFeeds);

console.log(`[gen] wrote ${nativeFeeds.length} native feeds -> ${OUT_NATIVE}`);
console.log(`[gen] wrote ${rsshubFeeds.length} RSSHub feeds -> ${OUT_RSSHUB}`);
