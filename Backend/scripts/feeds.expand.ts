/*
 Mega feed generator for Packaging Lead Intelligence
 -------------------------------------------------
 Drop this file at: Backend/scripts/feeds.expand.ts (replace your old one)

 Usage (from Backend/):
   node --loader ts-node/esm scripts/feeds.expand.ts \
     --out-native generated/feeds_native.txt \
     --out-rsshub generated/rsshub_feeds.txt \
     --rsshub-base "$RSSHUB_BASE" \
     --rsshub-key "$RSSHUB_KEY"

 It writes two deduped flat files. Extend arrays below freely.
*/

// ---------------- CLI ----------------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc: [string, string][], a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.replace(/^--/, ""), arr[i + 1] ?? ""]);
    return acc;
  }, [])
);

const OUT_NATIVE = args["out-native"] || "generated/feeds_native.txt";
const OUT_RSSHUB = args["out-rsshub"] || "generated/rsshub_feeds.txt";
const RSSHUB_BASE = (args["rsshub-base"] || process.env.RSSHUB_BASE || "").replace(/\/$/, "");
const RSSHUB_KEY = args["rsshub-key"] || process.env.RSSHUB_KEY || "";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function ensureDir(p: string) {
  try { mkdirSync(dirname(p), { recursive: true }); } catch {}
}

function enc(s: string) { return encodeURIComponent(s); }
function uniqPush(set: Set<string>, s: string) { if (s) set.add(s.trim()); }

// ---------------- Seeds (EDIT ME) ----------------

// Packaging SKU/terms (broad set)
const packagingTerms = [
  // cartons & boxes
  "custom boxes","corrugated boxes","mailer boxes","folding carton","rigid box","shipping boxes","printed boxes",
  // labels
  "labels","thermal transfer labels","direct thermal labels","rfid labels","ghs labels","nutrition labels","barcode labels",
  // pouches & film
  "stand up pouch","spout pouch","retort pouch","laminate film","rollstock","vacuum pouch","mylar bags","poly mailers","bubble mailers",
  // containers & closures
  "jars","bottles","glass bottles","dropper bottles","cosmetic jars","caps","closures","pumps","sprayers",
  // protection & industrial
  "edge protectors","pallets","ispm-15 crates","stretch film","shrink sleeve","shrink wrap","void fill","tissue paper","tape",
  // thermoform & specialty
  "blister","clamshell","thermoform","tray","inserts","hang tabs",
];

// Buying intent lexicon
const intentVerbs = [
  "need","looking for","require","seeking","sourcing","buy","purchase","wholesale",
  "rfq","rfi","rfp","request for quote","request a quote","quote for","tender","bid",
  "small moq","low moq","minimum order quantity"
];

// Vertical niches (to combine in news queries and CSE ideas)
const verticals = [
  "food and beverage","coffee","tea","bakery","cpk (cooked, prepared kits)","meal prep","cpg","dtc",
  "cosmetics","skincare","beauty","candles","cannabis","supplements","vitamins","electronics",
  "pet","pet food","apparel","subscription boxes","print on demand"
];

// Reddit subs (conservative, high-signal)
const redditSubs = [
  "packaging","SmallBusiness","Entrepreneur","startups","ecommerce","AmazonFBA","Etsy","Shopify",
  "FoodBusiness","coffee","tea","soapmaking","candlemaking","skincareaddiction","CosmeticChemistry",
  "legitcheck","logistics","shipping","warehouse","supplychain","PrintOnDemand",
  // verticals
  "craftbeer","winemaking","distilling","baking","chocolate","Nutrition","PetFood"
].map(s => s.replace(/^\//, ""));

// Craigslist metros (US & CA mix)
const clCities = [
  // US majors
  "newyork","losangeles","sfbay","sandiego","seattle","chicago","boston","philadelphia","washingtondc",
  "miami","orlando","tampa","atlanta","phoenix","denver","dallas","austin","houston","sanantonio",
  "minneapolis","detroit","nashville","charlotte","raleigh","richmond","pittsburgh","cleveland","columbus",
  "cincinnati","indianapolis","kansascity","stlouis","portland","sacramento","lasvegas","boise","spokane",
  "neworleans","memphis","birmingham","oklahomacity","saltlakecity","milwaukee","inlandempire","orangecounty",
  "anchorage","honolulu",
  // Canada
  "toronto","vancouver","montreal","calgary","ottawa","edmonton","winnipeg","victoria","quebec"
];

// eBay search terms (recent-first RSS)
const ebayKw = [
  ...packagingTerms,
  "shipping boxes","mailer box","packaging bags","stand-up pouch"
];

// News: domains (site: searches) + raw queries via Google/Bing
const newsDomains = [
  "packagingdigest.com","packagingeurope.com","packworld.com","packagingnews.co.uk","packaginginsights.com",
  "thomasnet.com","thedieline.com","materials-handling.com","pffc-online.com","packagingstrategies.com"
];

// RSSHub social handles (Threads/IG via mirrors) – brand/media mix
const socialHandles = [
  // media & vendors
  "packagingeurope","packagingdigest","thedieline","packworld","packhelp","uline",
  // big CPGs (for innovation / supplier calls)
  "cocacola","pepsi","nestle","unilever","proctergamble","mondelezinternational","kraftheinzco",
  "danone","marsglobal","loreal","jnj","colgatepalmoliveco"
];

// YouTube (RSSHub user routes) – prefer handles that are stable
const ytUsers = [
  "PackagingDigestVideo","thedieline","Uline","Packhelp","MavensofManufacturing",
  // add more if you know the user handle used by the channel
];

// Bluesky keyword firehose
const bskyKw = [
  "packaging","boxes","labels","pouch","pouches","bottle","bottles","jar","jars","pallets",
  "custom boxes","packaging supplier","rfq packaging","request for quote packaging"
];

// GitHub search seeds (BOM/specs/RFQs around machinery & packaging)
const githubKw = [
  "packaging rfq","rfq packaging machinery","corrugated box spec","label die line","pouch dieline",
  "gs1 label","upc label template","ispm-15 pallet"
];

// ---------------- Builders ----------------

function clFeed(city: string, q: string) {
  return `https://${city}.craigslist.org/search/sss?query=${enc(q)}&sort=date&format=rss`;
}

function ebayFeed(q: string) {
  return `https://www.ebay.com/sch/i.html?_nkw=${enc(q)}&_sop=10&rt=nc&_rss=1`;
}

function redditSearch(q: string) {
  return `https://www.reddit.com/search.rss?q=${enc(q)}&sort=new`;
}

function redditSubNew(sub: string) {
  return `https://www.reddit.com/r/${sub}/new.rss?sort=new`;
}

function gnews(q: string) {
  return `https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function bingNews(q: string) {
  return `https://www.bing.com/news/search?q=${enc(q)}&format=rss`;
}

function rsshub(path: string, extra = "") {
  if (!RSSHUB_BASE || !RSSHUB_KEY) return ""; // allow running without
  const sep = path.includes("?") ? "&" : "?";
  return `${RSSHUB_BASE}${path}${sep}key=${enc(RSSHUB_KEY)}${extra}`;
}

// ---------------- Generate ----------------

const native = new Set<string>();
const hub = new Set<string>();

// Reddit: intent searches
const intentSearches = [
  "need packaging","\"request for quote\" packaging","looking for packaging","looking for packaging supplier",
  "need custom boxes","need stand up pouch","need labels","small MOQ packaging","packaging supplier recommendation",
  "co-packer","where to buy packaging","packaging needed","purchase order packaging"
];
intentSearches.forEach(q => uniqPush(native, redditSearch(q)));

// Reddit: sub feeds
redditSubs.forEach(s => uniqPush(native, redditSubNew(s)));

// Craigslist per city × core queries
const clQueries = [
  "custom boxes","corrugated boxes","stand up pouch","labels","thermal transfer labels","direct thermal labels",
  "shrink sleeve","shrink wrap","export crate","pallets","packaging supplier","mailer boxes","edge protectors",
  "rollstock","poly mailers","bubble mailers","clamshell","blister"
];
clCities.forEach(city => clQueries.forEach(q => uniqPush(native, clFeed(city, q))));

// eBay
[...new Set(ebayKw)].forEach(q => uniqPush(native, ebayFeed(q)));

// News – combinatoric intent × term
intentVerbs.forEach(v => packagingTerms.forEach(t => uniqPush(native, gnews(`${v} ${t}`))));
// News – vertical targeting
verticals.forEach(v => uniqPush(native, gnews(`packaging ${v}`)));
// News – site scoped
newsDomains.forEach(d => uniqPush(native, gnews(`site:${d} (rfq OR tender OR \"request for quote\" OR packaging)`)));
// Bing News: a few high-signal lexicon
["request for quote packaging","rfq packaging","packaging tender"].forEach(q => uniqPush(native, bingNews(q)));

// YouTube – native (only when you know channel_id). You can add more IDs.
const ytChannelIds: string[] = [
  // Packaging Europe, Packaging School, Packaging Machinery (examples from your earlier list)
  "UCMlfvZg87EtSegSdLZ-Dhxw","UCsERIdRMS0xRD35DfjuAUbA","UCm76sBHRiZHX1A_DvlYjZGQ","UCQ72hR86RHBS9tOWc4E-5jg"
];
ytChannelIds.forEach(id => uniqPush(native, `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`));

// RSSHub – Bluesky
bskyKw.forEach(k => uniqPush(hub, rsshub(`/bsky/keyword/${enc(k)}`, `&limit=40&filter_title=rfq|quote|need|supplier`)));

// RSSHub – Threads
socialHandles.forEach(h => uniqPush(hub, rsshub(`/threads/${h}`, `&limit=20`)));

// RSSHub – Instagram mirrors (Picnob + Picuki)
socialHandles.forEach(h => {
  uniqPush(hub, rsshub(`/picnob/user/${h}`, `&limit=20`));
  uniqPush(hub, rsshub(`/picuki/profile/${h}`, `&limit=20`));
});

// RSSHub – YouTube by user handle
ytUsers.forEach(u => uniqPush(hub, rsshub(`/youtube/user/${u}`, `&limit=20`)));

// RSSHub – GitHub search
githubKw.forEach(k => uniqPush(hub, rsshub(`/github/search/${enc(k)}/bestmatch/desc`, `&limit=20`)));

// ---------------- Write ----------------
function writeList(path: string, set: Set<string>) {
  const list = Array.from(set).filter(Boolean).sort();
  ensureDir(path);
  writeFileSync(path, list.join("\n") + "\n", "utf8");
  console.log(`[gen] ${path} -> ${list.length} lines`);
}

writeList(OUT_NATIVE, native);
writeList(OUT_RSSHUB, hub);

console.log("[gen] done.");
