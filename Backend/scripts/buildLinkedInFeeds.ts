

import fetch from 'node-fetch';

const API_KEY = process.env.CSE_API_KEY || '';
const CX = process.env.CSE_CX || '';
const BASE = (process.env.RSSHUB_BASE || '').replace(/\/$/, '');
const KEY = process.env.RSSHUB_KEY || '';
const MAX_RESULTS = Number(process.env.MAX_RESULTS || 600);

if (!API_KEY || !CX) {
  console.error('
[buildLinkedInFeeds] Missing CSE_API_KEY or CSE_CX.');
  process.exit(1);
}
if (!BASE || !KEY) {
  console.error('
[buildLinkedInFeeds] Missing RSSHUB_BASE or RSSHUB_KEY.');
  process.exit(1);
}

// ---------------- Query seeds ----------------
// SUPPLIERS: manufacturers, converters, printers, labelers, co-packers, corrugated
const SUPPLIER_QUERIES = [
  'site:linkedin.com/company packaging manufacturer',
  'site:linkedin.com/company packaging supplier',
  'site:linkedin.com/company corrugated boxes manufacturer',
  'site:linkedin.com/company folding carton',
  'site:linkedin.com/company labels manufacturer',
  'site:linkedin.com/company shrink sleeve labels',
  'site:linkedin.com/company flexible packaging film',
  'site:linkedin.com/company stand up pouches supplier',
  'site:linkedin.com/company label printer',
  'site:linkedin.com/company co-packer',
  'site:linkedin.com/company contract packaging',
  'site:linkedin.com/company packaging design agency',
  'site:linkedin.com/company display pop packaging',
  'site:linkedin.com/company pallets crate ispm-15',
  'site:linkedin.com/company protective packaging foam',
];

// BUYERS: brands/industries that buy packaging (US/Canada heavy users)
// We combine with "company" to bias towards company pages, not people.
const BUYER_QUERIES = [
  'site:linkedin.com/company food brand United States',
  'site:linkedin.com/company beverage brand United States',
  'site:linkedin.com/company cosmetics brand United States',
  'site:linkedin.com/company personal care brand United States',
  'site:linkedin.com/company pet food brand United States',
  'site:linkedin.com/company vitamin supplements brand United States',
  'site:linkedin.com/company e-commerce brand United States',
  'site:linkedin.com/company DTC brand United States',
  'site:linkedin.com/company meal kit United States',
  'site:linkedin.com/company cannabis brand United States',
  'site:linkedin.com/company craft brewery United States',
  'site:linkedin.com/company coffee roaster United States',
  'site:linkedin.com/company frozen foods United States',
  'site:linkedin.com/company confectionery United States',
  'site:linkedin.com/company nutraceutical United States',
  'site:linkedin.com/company pet treats Canada',
  'site:linkedin.com/company cosmetics brand Canada',
  'site:linkedin.com/company beverage brand Canada',
];

const ALL_QUERIES = [...SUPPLIER_QUERIES, ...BUYER_QUERIES];

// ---------------- Helpers ----------------
function sleep(ms: number){ return new Promise(res => setTimeout(res, ms)); }

function extractCompanySlug(u: string): string | null {
  // Expect formats like:
  //  https://www.linkedin.com/company/<slug>/
  //  https://www.linkedin.com/company/<numeric-id>/
  try {
    const url = new URL(u);
    if (!/linkedin\.com$/.test(url.hostname.replace(/^www\./, ''))) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('company');
    if (i === -1 || i === parts.length - 1) return null;
    const id = parts[i + 1];
    // Clean trailing tracking params in path segment
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  } catch {
    return null;
  }
}

async function cseSearch(q: string, start = 1){
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(API_KEY)}&cx=${encodeURIComponent(CX)}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`CSE ${r.status} for ${q}`);
  return r.json() as Promise<{ items?: Array<{ link?: string; title?: string; snippet?: string }> }>
}

async function* cseIter(q: string, pages = 3){
  // up to 3 pages → ~30 results per query (free tier friendly)
  for(let p=0; p<pages; p++){
    const start = 1 + p*10;
    try {
      const data = await cseSearch(q, start);
      const items = data.items || [];
      for(const it of items) yield it;
      // politeness to avoid 429/limit
      await sleep(300);
    } catch {
      // ignore single-page errors to keep going
      await sleep(500);
    }
  }
}

function buildFeed(slug: string){
  return `${BASE}/linkedin/company/${encodeURIComponent(slug)}/posts?key=${encodeURIComponent(KEY)}&limit=30`;
}

(async function main(){
  const seen = new Set<string>();
  const feeds: string[] = [];

  for(const q of ALL_QUERIES){
    for await (const it of cseIter(q, 3)){
      const link = it.link || '';
      const slug = extractCompanySlug(link);
      if(!slug) continue;
      if(seen.has(slug)) continue;
      seen.add(slug);
      feeds.push(buildFeed(slug));
      if(feeds.length >= MAX_RESULTS){
        console.error(`[cap] Reached MAX_RESULTS=${MAX_RESULTS}`);
        break;
      }
    }
    if(feeds.length >= MAX_RESULTS) break;
  }

  // Print as a single comma-separated line for Render env
  const line = feeds.join(',');
  console.log(line);
  console.error(`
[buildLinkedInFeeds] companies=${feeds.length} (unique slugs)
`);
})();
