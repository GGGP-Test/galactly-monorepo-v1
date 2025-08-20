

// ---------------- tiny arg parser ----------------
function parseArgs(){
  const a = process.argv.slice(2); const out = {};
  for(let i=0;i<a.length;i++){
    const k = a[i]; if(!k.startsWith("--")) continue;
    const key = k.slice(2);
    const v = (i+1<a.length && !a[i+1].startsWith("--")) ? a[++i] : "true";
    out[key] = v;
  }
  return out;
}
const ARGS = parseArgs();

const PLATFORM = (ARGS["platform"]||"all").toLowerCase(); // instagram|threads|youtube|twitter|all
const API_KEYS = (ARGS["api-keys"]||"").split(",").map(s=>s.trim()).filter(Boolean);
const CXS      = (ARGS["cxs"]||"").split(",").map(s=>s.trim()).filter(Boolean);
const BASE     = (ARGS["base"]||"").replace(/\/$/, "");
const ACCESS   = (ARGS["access-key"]||"").trim();
const MAX_RESULTS = Number(ARGS["max"]||600);
const PAGES_PER_QUERY = Math.max(1, Math.min(10, Number(ARGS["pages"]||3)));
const SLEEP_MS = Math.max(100, Number(ARGS["sleep"]||300));
const GEO = String(ARGS["geo"]||"NA").toUpperCase(); // US|CA|NA|ALL

if(!API_KEYS.length || !CXS.length){ console.error("[social-cse] Missing --api-keys or --cxs"); process.exit(1); }
if(!BASE || !ACCESS){ console.error("[social-cse] Missing --base or --access-key"); process.exit(1); }

// ---------------- seeds (ASCII only) ----------------
const SUPPLIER_CATEGORIES = [
  "packaging manufacturer","packaging supplier","packaging converter",
  "corrugated boxes manufacturer","folding carton","rigid box","paperboard",
  "labels manufacturer","thermal transfer labels","ghs labels","rfid labels","shrink sleeve labels",
  "flexible packaging film","laminate film","rollstock","stand up pouches supplier","spouted pouch","retort pouch","mono material",
  "protective packaging","void fill","foam in place","edge protectors",
  "crating","ispm 15 pallets","export pallets","skids",
  "digital printing packaging","flexo printing","gravure printing","offset printing",
  "co packer","contract packaging","display pop packaging","kitting","3pl",
  "sustainable packaging","compostable packaging","recyclable packaging","pcr packaging"
];
const BUYER_SECTORS = [
  "food brand","beverage brand","beer brand","craft brewery","coffee roaster",
  "confectionery","frozen foods","meal kit","pet food brand","pet treats",
  "cosmetics brand","beauty brand","personal care brand","fragrance brand",
  "dietary supplements brand","nutraceutical brand",
  "household goods brand","home care brand",
  "electronics accessories brand","small appliance brand",
  "cannabis brand","cbd brand","dtc brand","e commerce brand","subscription box brand"
];
const PROCUREMENT_TERMS = ["procurement","sourcing","purchasing","buyer","supply chain","vendor management"];
const GEO_US_STATES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const GEO_CA_PROV = ["Ontario","Quebec","British Columbia","Alberta","Manitoba","Saskatchewan","Nova Scotia","New Brunswick","Newfoundland","Prince Edward Island"];

function geoTerms(){
  if (GEO === "US") return ["United States","USA"].concat(GEO_US_STATES);
  if (GEO === "CA") return ["Canada"].concat(GEO_CA_PROV);
  if (GEO === "ALL") return [];
  return ["United States","USA","Canada","North America"]; // NA default
}

function makeQueries(){
  const out = new Set();
  const geos = geoTerms();
  const domains = {
    instagram: "site:instagram.com",
    threads:   "site:threads.net",
    youtube:   "site:youtube.com",
    twitter:   "site:twitter.com OR site:x.com",
  };
  const d = (PLATFORM==='all') ? Object.values(domains) : [domains[PLATFORM]];

  function add(base){ if(!geos.length) out.add(base); else for(const g of geos) out.add(base+" "+g); }

  for(const dom of d){
    for(const kw of SUPPLIER_CATEGORIES){ add(dom+" "+kw); }
    for(const sec of BUYER_SECTORS){ add(dom+" "+sec); }
    for(const sec of BUYER_SECTORS){ for(const pr of PROCUREMENT_TERMS){ add(dom+" "+sec+" "+pr); }}
  }
  return Array.from(out);
}

// ---------------- CSE plumbing ----------------
let keyIdx = 0, cxIdx = 0;
function nextKey(){ const v = API_KEYS[keyIdx % API_KEYS.length]; keyIdx++; return v; }
function nextCx(){ const v = CXS[cxIdx % CXS.length]; cxIdx++; return v; }
async function cseSearch(q, start, key, cx){
  const u = "https://www.googleapis.com/customsearch/v1?key="+encodeURIComponent(key)+"&cx="+encodeURIComponent(cx)+"&q="+encodeURIComponent(q)+"&num=10&start="+start;
  const r = await fetch(u);
  if(!r.ok) throw new Error("CSE "+r.status);
  return r.json();
}
function sleep(ms){ return new Promise(res=>setTimeout(res,ms)); }

// ---------------- Extractors by platform ----------------
function extractInstagramHandle(u){
  try{
    const url = new URL(u);
    if(!/instagram\.com$/.test(url.hostname.replace(/^www\./,''))) return null;
    const seg = url.pathname.split('/').filter(Boolean);
    const first = seg[0]||'';
    if(['p','reel','explore','stories'].includes(first)) return null; // not a profile
    if(first.length>1 && first.length<32) return first; // simple heuristic
    return null;
  }catch{ return null; }
}
function extractThreadsHandle(u){
  try{
    const url = new URL(u);
    if(!/threads\.net$/.test(url.hostname.replace(/^www\./,''))) return null;
    const seg = url.pathname.split('/').filter(Boolean);
    let h = seg[0]||''; if(h.startsWith('@')) h = h.slice(1);
    if(!h) return null; return h;
  }catch{ return null; }
}
function extractYouTube(u){
  try{
    const url = new URL(u);
    if(!/youtube\.com$/.test(url.hostname.replace(/^www\./,''))) return null;
    const seg = url.pathname.split('/').filter(Boolean);
    if(seg[0]==='@'){ return { type:'user', value:'@'+seg[0+0].slice(1) }; }
    if(seg[0]==='channel' && seg[1]){ return { type:'channel', value:seg[1] }; }
    if(seg[0]==='user' && seg[1]){ return { type:'user', value:seg[1] }; }
    if(seg[0]==='c' && seg[1]){ return { type:'user', value:seg[1] }; }
    return null;
  }catch{ return null; }
}
function extractTwitterHandle(u){
  try{
    const url = new URL(u);
    if(!/(twitter|x)\.com$/.test(url.hostname.replace(/^www\./,''))) return null;
    const seg = url.pathname.split('/').filter(Boolean);
    const first = seg[0]||'';
    if(['i','intent','hashtag','search','home'].includes(first)) return null;
    if(first && !first.includes(':') && first.length<32) return first;
    return null;
  }catch{ return null; }
}

// ---------------- Builders ----------------
function rsshubPicnob(handle){ return BASE+"/picnob/user/"+encodeURIComponent(handle)+"?key="+encodeURIComponent(ACCESS)+"&limit=20"; }
function rsshubPicuki(handle){ return BASE+"/picuki/profile/"+encodeURIComponent(handle)+"?key="+encodeURIComponent(ACCESS)+"&limit=20"; }
function rsshubThreads(handle){ return BASE+"/threads/"+encodeURIComponent(handle)+"?key="+encodeURIComponent(ACCESS)+"&limit=20"; }
function rsshubYouTubeUser(user){ return BASE+"/youtube/user/"+encodeURIComponent(user)+"?key="+encodeURIComponent(ACCESS)+"&limit=20"; }
function rsshubYouTubeChannel(id){ return BASE+"/youtube/channel/"+encodeURIComponent(id)+"?key="+encodeURIComponent(ACCESS)+"&limit=20"; }
function nativeNitter(handle){ return "https://nitter.net/"+encodeURIComponent(handle)+"/rss"; }

(async function main(){
  const queries = makeQueries();
  console.error("[social-cse] queries="+queries.length+", pages="+PAGES_PER_QUERY);

  const rsshub = new Set();
  const native = new Set();

  outer: for(const q of queries){
    for(let p=0;p<PAGES_PER_QUERY;p++){
      const start = 1 + p*10;
      const key = nextKey();
      const cx = nextCx();
      try{
        const data = await cseSearch(q, start, key, cx);
        const items = (data && data.items) ? data.items : [];
        for(const it of items){
          const link = it.link || '';
          if(PLATFORM==='instagram' || PLATFORM==='all'){
            const h = extractInstagramHandle(link); if(h){ rsshub.add(rsshubPicnob(h)); rsshub.add(rsshubPicuki(h)); }
          }
          if(PLATFORM==='threads'   || PLATFORM==='all'){
            const h = extractThreadsHandle(link);   if(h){ rsshub.add(rsshubThreads(h)); }
          }
          if(PLATFORM==='youtube'   || PLATFORM==='all'){
            const yo = extractYouTube(link); if(yo){ if(yo.type==='user') rsshub.add(rsshubYouTubeUser(yo.value)); else rsshub.add(rsshubYouTubeChannel(yo.value)); }
          }
          if(PLATFORM==='twitter'   || PLATFORM==='all'){
            const h = extractTwitterHandle(link);  if(h){ native.add(nativeNitter(h)); }
          }
          if(rsshub.size + native.size >= MAX_RESULTS){ console.error("[social-cse] max reached"); break outer; }
        }
      }catch(e){ /* ignore and rotate */ }
      await sleep(SLEEP_MS);
    }
  }

  // emit files side by side
  const fs = await import('fs');
  const rsshubLine = Array.from(rsshub).join(',');
  const nativeLine = Array.from(native).join(',');
  try{ fs.writeFileSync('rsshub_feeds.txt', rsshubLine); }catch{}
  try{ fs.writeFileSync('native_feeds.txt', nativeLine); }catch{}

  console.error("[social-cse] rsshub feeds="+ (rsshub.size));
  console.error("[social-cse] native feeds="+ (native.size));
  console.log("Done. Open rsshub_feeds.txt and native_feeds.txt");
})();
