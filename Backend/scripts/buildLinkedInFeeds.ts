// File: scripts/buildLinkedInFeeds.ts
// Goal: Generate a BIG, de‑duplicated list of LinkedIn Company feed URLs for RSSHub
//       covering both SUPPLIERS (packaging makers) and BUYERS (brands/CPG/etc.).
// Output: one comma-separated line:
//   https://<BASE>/linkedin/company/<slug-or-id>/posts?key=<KEY>&limit=30,https://...
// You paste that line into Render → your API service → Environment → RSSHUB_FEEDS.
//
// Why this approach
// - Compliant: We query Google Programmable Search (CSE) JSON API (public results),
//   restricted to linkedin.com/company/*, then convert found company URLs into
//   RSSHub company post feeds.
// - Scalable: You can run multiple times, expand seeds, cap volume with MAX_RESULTS.
// - Robust: Works with slugs OR numeric company IDs.
//
// REQUIRED ENVs (set in your terminal before running):
//   CSE_API_KEYS=key1[,key2,...]      // one or more Google CSE API keys (rotated)
//   CSE_CXS=cx1[,cx2,...]             // one or more CSE engine IDs (rotated)
//   // Your CSEs should be restricted to linkedin.com/company/* for best precision.
//
//   RSSHUB_BASE=https://<your-rsshub-domain>      // e.g., https://galactly-rsshub.onrender.com
//   RSSHUB_KEY=<ACCESS_KEY>                       // same ACCESS_KEY set on your RSSHub service
//
// OPTIONAL ENVs:
//   MAX_RESULTS=1200               // default 600; caps total companies emitted
//   PAGES_PER_QUERY=3              // each page has up to 10 results; default 3→~30
//   SLEEP_MS=300                   // politeness sleep between calls
//   INCLUDE_BUYERS=true|false      // default true
//   INCLUDE_SUPPLIERS=true|false   // default true
//   GEO=US|CA|NA|ALL               // geo bias in queries (default: NA = US+CA)
//   OUT_FILE=linkedin_feeds.txt    // if set, also writes the output to this file
//
// USAGE (macOS/Windows PowerShell):
//   # 1) Install deps, build TS
//   npm ci
//   npm run build
//   # 2) Set ENVs and run (macOS/Linux bash example)
//   export CSE_API_KEYS=key1,key2
//   export CSE_CXS=cx_abc,cx_def
//   export RSSHUB_BASE=https://your-rsshub.onrender.com
//   export RSSHUB_KEY=YOUR_ACCESS_KEY
//   node dist/scripts/buildLinkedInFeeds.js > linkedin_feeds.txt
//   # Paste the single line from linkedin_feeds.txt into Render env RSSHUB_FEEDS

import fetch from 'node-fetch';
import fs from 'fs';

// ---------- ENV ----------
const API_KEYS = (process.env.CSE_API_KEYS || '').split(',').map(s=>s.trim()).filter(Boolean);
const CXS = (process.env.CSE_CXS || '').split(',').map(s=>s.trim()).filter(Boolean);
const BASE = (process.env.RSSHUB_BASE || '').replace(/\/$/, '');
const KEY = process.env.RSSHUB_KEY || '';
const MAX_RESULTS = Number(process.env.MAX_RESULTS || 600);
const PAGES_PER_QUERY = Math.max(1, Math.min(10, Number(process.env.PAGES_PER_QUERY || 3)));
const SLEEP_MS = Math.max(100, Number(process.env.SLEEP_MS || 300));
const INCLUDE_BUYERS = (process.env.INCLUDE_BUYERS ?? 'true').toLowerCase() !== 'false';
const INCLUDE_SUPPLIERS = (process.env.INCLUDE_SUPPLIERS ?? 'true').toLowerCase() !== 'false';
const GEO = (process.env.GEO || 'NA').toUpperCase(); // US, CA, NA, ALL
const OUT_FILE = process.env.OUT_FILE || '';

if (!API_KEYS.length || !CXS.length) {
  console.error('
[buildLinkedInFeeds] Missing CSE_API_KEYS or CSE_CXS.');
  process.exit(1);
}
if (!BASE || !KEY) {
  console.error('
[buildLinkedInFeeds] Missing RSSHUB_BASE or RSSHUB_KEY.');
  process.exit(1);
}

// ---------- Query Seeds (programmatic expansion) ----------
const SUPPLIER_CATEGORIES = [
  'packaging manufacturer', 'packaging supplier', 'packaging converter',
  'corrugated boxes manufacturer', 'folding carton', 'rigid box',
  'labels manufacturer', 'thermal transfer labels', 'ghs labels', 'rfid labels',
  'shrink sleeve labels', 'flexible packaging film', 'laminate film', 'rollstock',
  'stand up pouches supplier', 'spouted pouch', 'retort pouch', 'mono-material',
  'protective packaging', 'void fill', 'foam in place', 'edge protectors',
  'crating', 'ispm-15 pallets', 'export pallets', 'skids',
  'digital printing packaging', 'flexo printing', 'gravure printing', 'offset printing',
  'co-packer', 'contract packaging', 'display pop packaging', 'kitting', '3pl',
  'sustainable packaging', 'compostable packaging', 'recyclable packaging', 'pcr packaging'
];

const BUYER_SECTORS = [
  'food brand', 'beverage brand', 'beer brand', 'craft brewery', 'coffee roaster',
  'confectionery', 'frozen foods', 'meal kit', 'pet food brand', 'pet treats',
  'cosmetics brand', 'beauty brand', 'personal care brand', 'fragrance brand',
  'dietary supplements brand', 'nutraceutical brand',
  'household goods brand', 'home care brand',
  'electronics accessories brand', 'small appliance brand',
  'cannabis brand', 'cbd brand',
  'dtc brand', 'e-commerce brand', 'subscription box brand'
];

const PROCUREMENT_TERMS = [
  'procurement', 'sourcing', 'purchasing', 'buyer', 'supply chain', 'vendor management'
];

const RFQ_TERMS = [ 'rfq', 'request for quote', 'request for proposal', 'tender', 'bid' ];

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia',
  'Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland',
  'Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
  'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
  'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'
];
const CA_PROVINCES = ['Ontario','Quebec','British Columbia','Alberta','Manitoba','Saskatchewan','Nova Scotia','New Brunswick','Newfoundland','PEI'];

function geoTerms(){
  if (GEO === 'US') return ['United States','USA', ...US_STATES];
  if (GEO === 'CA') return ['Canada', ...CA_PROVINCES];
  if (GEO === 'ALL') return [];
  return ['United States','USA','Canada','North America']; // NA default
}

function makeQueries(): string[] {
  const queries: string[] = [];
  const geos = geoTerms();

  if (INCLUDE_SUPPLIERS) {
    for (const cat of SUPPLIER_CATEGORIES) {
      const base = `site:linkedin.com/company ${cat}`;
      if (!geos.length) { queries.push(base); }
      else for (const g of geos) queries.push(`${base} ${g}`);
    }
  }
  if (INCLUDE_BUYERS) {
    for (const sec of BUYER_SECTORS) {
      const base = `site:linkedin.com/company ${sec}`;
      if (!geos.length) { queries.push(base); }
      else for (const g of geos) queries.push(`${base} ${g}`);
    }
    // Buyer + procurement terms to bias to ops roles
    for (const sec of BUYER_SECTORS) {
      for (const pr of PROCUREMENT_TERMS) {
        const base = `site:linkedin.com/company ${sec} ${pr}`;
        if (!geos.length) { queries.push(base); }
        else for (const g of geos) queries.push(`${base} ${g}`);
      }
    }
  }
  // Sprinkle RFQ terms (note: CSE often treats quotes literally; we keep plain)
  for (const rfq of RFQ_TERMS) {
    const base = `site:linkedin.com/company ${rfq} packaging`;
    if (!geos.length) { queries.push(base); }
    else for (const g of geos) queries.push(`${base} ${g}`);
  }

  // De-dup queries and cap to a safe planning number (~5k) before paging
  return Array.from(new Set(queries)).slice(0, 5000);
}

// ---------- CSE plumbing ----------
let keyIdx = 0; let cxIdx = 0;
function nextKey(){ const v = API_KEYS[keyIdx % API_KEYS.length]; keyIdx++; return v; }
function nextCx(){ const v = CXS[cxIdx % CXS.length]; cxIdx++; return v; }

async function cseSearch(q: string, start = 1, key: string, cx: string){
  const u = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
  const r = await fetch(u);
  if(!r.ok) throw new Error(`CSE ${r.status}`);
  return r.json() as Promise<{ items?: Array<{ link?: string; title?: string; snippet?: string }> }>
}

function sleep(ms: number){ return new Promise(res => setTimeout(res, ms)); }

function extractCompanySlug(u: string): string | null {
  try {
    const url = new URL(u);
    if (!/linkedin\.com$/.test(url.hostname.replace(/^www\./, ''))) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('company');
    if (i === -1 || i === parts.length - 1) return null;
    const id = parts[i + 1];
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  } catch { return null; }
}

function buildFeed(slug: string){
  return `${BASE}/linkedin/company/${encodeURIComponent(slug)}/posts?key=${encodeURIComponent(KEY)}&limit=30`;
}

(async function main(){
  const queries = makeQueries();
  console.error(`[buildLinkedInFeeds] queries=${queries.length}, pages=${PAGES_PER_QUERY}`);

  const seenSlug = new Set<string>();
  const feeds: string[] = [];

  outer: for (const q of queries){
    for (let p=0; p<PAGES_PER_QUERY; p++){
      const start = 1 + p*10;
      const key = nextKey();
      const cx = nextCx();
      try {
        const data = await cseSearch(q, start, key, cx);
        const items = data.items || [];
        for (const it of items){
          const link = it.link || '';
          const slug = extractCompanySlug(link);
          if(!slug) continue;
          if(seenSlug.has(slug)) continue;
          seenSlug.add(slug);
          feeds.push(buildFeed(slug));
          if (feeds.length >= MAX_RESULTS){
            console.error(`[cap] MAX_RESULTS=${MAX_RESULTS} reached.`);
            break outer;
          }
        }
      } catch (e:any) {
        // ignore single error; rotate key/cx and continue
      }
      await sleep(SLEEP_MS);
    }
  }

  const line = feeds.join(',');
  console.log(line);
  console.error(`
[buildLinkedInFeeds] emitted companies=${feeds.length}`);
  if (OUT_FILE){ try { fs.writeFileSync(OUT_FILE, line); } catch {} }
})();
