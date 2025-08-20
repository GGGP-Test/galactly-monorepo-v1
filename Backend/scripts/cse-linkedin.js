// File: scripts/cse-linkedin.js
// Run with Node 20+ (no installs). It builds a giant, de‑duplicated list of
// LinkedIn company RSSHub feed URLs (buyers + suppliers) and prints ONE line
// you can paste into Render env var `RSSHUB_FEEDS`.
//
// Example:
//   node scripts/cse-linkedin.js \
//     --api-keys KEY1,KEY2 \
//     --cxs CX1,CX2 \
//     --base https://your-rsshub.onrender.com \
//     --access-key YOUR_ACCESS_KEY \
//     --max 1200 --pages 3 --geo NA > linkedin_feeds.txt
//
// Flags:
//   --api-keys     Comma list of Google CSE API keys (rotate across)
//   --cxs          Comma list of Google CSE engine IDs (restrict to linkedin.com/company/*)
//   --base         Your RSSHub base, no trailing slash (e.g., https://rsshub.onrender.com)
//   --access-key   ACCESS_KEY you set on your RSSHub instance
//   --max          Max companies to emit (default 600)
//   --pages        Pages per query (10 results/page). Default 3 (≈30 results/query)
//   --sleep        Milliseconds between requests (default 300)
//   --geo          US | CA | NA | ALL (default NA = U.S. + Canada bias)
//   --only        buyers | suppliers | both (default both)
//
// Output: a single comma-separated line of full feed URLs like
//   https://<BASE>/linkedin/company/<slug-or-id>/posts?key=<KEY>&limit=30,https://...

// ----- tiny arg parser -----
function parseArgs(){
  const a = process.argv.slice(2);
  const out = {};
  for(let i=0;i<a.length;i++){
    const k = a[i];
    if(!k.startsWith('--')) continue;
    const key = k.slice(2);
    const v = (i+1 < a.length && !a[i+1].startsWith('--')) ? a[++i] : 'true';
    out[key] = v;
  }
  return out;
}
const ARGS = parseArgs();

// ----- config from args -----
const API_KEYS = (ARGS['api-keys']||'').split(',').map(s=>s.trim()).filter(Boolean);
const CXS      = (ARGS['cxs']||'').split(',').map(s=>s.trim()).filter(Boolean);
const BASE     = (ARGS['base']||'').replace(/\/$/,'');
const KEY      = (ARGS['access-key']||'').trim();
const MAX_RESULTS = Number(ARGS['max']||600);
const PAGES_PER_QUERY = Math.max(1, Math.min(10, Number(ARGS['pages']||3)));
const SLEEP_MS = Math.max(100, Number(ARGS['sleep']||300));
const GEO = String(ARGS['geo']||'NA').toUpperCase();
const ONLY = (ARGS['only']||'both').toLowerCase(); // buyers|suppliers|both

if(!API_KEYS.length || !CXS.length){
  console.error('
[cse-linkedin] Missing --api-keys or --cxs');
  process.exit(1);
}
if(!BASE || !KEY){
  console.error('
[cse-linkedin] Missing --base or --access-key');
  process.exit(1);
}

// ----- seed generator -----
const SUPPLIER_CATEGORIES = [
  'packaging manufacturer','packaging supplier','packaging converter',
  'corrugated boxes manufacturer','folding carton','rigid box','paperboard',
  'labels manufacturer','thermal transfer labels','ghs labels','rfid labels','shrink sleeve labels',
  'flexible packaging film','laminate film','rollstock','stand up pouches supplier','spouted pouch','retort pouch','mono-material',
  'protective packaging','void fill','foam in place','edge protectors',
  'crating','ispm-15 pallets','export pallets','skids',
  'digital printing packaging','flexo printing','gravure printing','offset printing',
  'co-packer','contract packaging','display pop packaging','kitting','3pl',
  'sustainable packaging','compostable packaging','recyclable packaging','pcr packaging'
];

const BUYER_SECTORS = [
  'food brand','beverage brand','beer brand','craft brewery','coffee roaster',
  'confectionery','frozen foods','meal kit','pet food brand','pet treats',
  'cosmetics brand','beauty brand','personal care brand','fragrance brand',
  'dietary supplements brand','nutraceutical brand',
  'household goods brand','home care brand',
  'electronics accessories brand','small appliance brand',
  'cannabis brand','cbd brand','dtc brand','e-commerce brand','subscription box brand'
];

const PROCUREMENT_TERMS = ['procurement','sourcing','purchasing','buyer','supply chain','vendor management'];
const RFQ_TERMS = ['rfq','request for quote','request for proposal','tender','bid'];

const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
const CA_PROVINCES = ['Ontario','Quebec','British Columbia','Alberta','Manitoba','Saskatchewan','Nova Scotia','New Brunswick','Newfoundland','Prince Edward Island'];

function geoTerms(){
  if (GEO === 'US') return ['United States','USA', ...US_STATES];
  if (GEO === 'CA') return ['Canada', ...CA_PROVINCES];
  if (GEO === 'ALL') return [];
  return ['United States','USA','Canada','North America']; // NA default
}

function makeQueries(){
  const out = new Set();
  const geos = geoTerms();

  if(ONLY==='both' || ONLY==='suppliers'){
    for(const cat of SUPPLIER_CATEGORIES){
      const base = `site:linkedin.com/company ${cat}`;
      if(!geos.length) out.add(base); else for(const g of geos) out.add(`${base} ${g}`);
    }
  }
  if(ONLY==='both' || ONLY==='buyers'){
    for(const sec of BUYER_SECTORS){
      const base = `site:linkedin.com/company ${sec}`;
      if(!geos.length) out.add(base); else for(const g of geos) out.add(`${base} ${g}`);
    }
    for(const sec of BUYER_SECTORS){
      for(const pr of PROCUREMENT_TERMS){
        const base = `site:linkedin.com/company ${sec} ${pr}`;
        if(!geos.length) out.add(base); else for(const g of geos) out.add(`${base} ${g}`);
      }
    }
  }
  for(const rfq of RFQ_TERMS){
    const base = `site:linkedin.com/company ${rfq} packaging`;
    if(!geos.length) out.add(base); else for(const g of geos) out.add(`${base} ${g}`);
  }
  return Array.from(out);
}

// ----- CSE plumbing -----
let keyIdx = 0, cxIdx = 0;
function nextKey(){ const v = API_KEYS[keyIdx % API_KEYS.length]; keyIdx++; return v; }
function nextCx(){ const v = CXS[cxIdx % CXS.length]; cxIdx++; return v; }

async function cseSearch(q, start, key, cx){
  const u = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
  const r = await fetch(u);
  if(!r.ok) throw new Error(`CSE ${r.status}`);
  return r.json();
}
function sleep(ms){ return new Promise(res=>setTimeout(res,ms)); }

function extractCompanySlug(u){
  try{
    const url = new URL(u);
    if(!/linkedin\.com$/.test(url.hostname.replace(/^www\./,''))) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const i = parts.indexOf('company');
    if(i===-1 || i===parts.length-1) return null;
    const id = parts[i+1];
    return id.replace(/[^a-zA-Z0-9_-]/g,'');
  }catch{ return null; }
}
function buildFeed(slug){
  return `${BASE}/linkedin/company/${encodeURIComponent(slug)}/posts?key=${encodeURIComponent(KEY)}&limit=30`;
}

(async function main(){
  const queries = makeQueries();
  console.error(`[cse-linkedin] queries=${queries.length}, pages=${PAGES_PER_QUERY}`);

  const seen = new Set();
  const feeds = [];

  outer: for(const q of queries){
    for(let p=0;p<PAGES_PER_QUERY;p++){
      const start = 1 + p*10;
      const key = nextKey();
      const cx = nextCx();
      try{
        const data = await cseSearch(q, start, key, cx);
        const items = data.items || [];
        for(const it of items){
          const link = it.link || '';
          const slug = extractCompanySlug(link);
          if(!slug) continue;
          if(seen.has(slug)) continue;
          seen.add(slug);
          feeds.push(buildFeed(slug));
          if(feeds.length >= MAX_RESULTS){
            console.error(`[cap] MAX_RESULTS=${MAX_RESULTS} reached`);
            break outer;
          }
        }
      }catch(e){ /* ignore; rotate key/cx and continue */ }
      await sleep(SLEEP_MS);
    }
  }

  const line = feeds.join(',');
  console.log(line);
  console.error(`
[cse-linkedin] emitted=${feeds.length}`);
})();
