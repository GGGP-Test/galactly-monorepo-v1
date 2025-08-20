// File: scripts/cse-fast.js
// Purpose: FAST mode discovery with constant progress logs + incremental writes
// Works with: instagram, threads, youtube, twitter (nitter), etsy, reddit, linkedin(company)
// Zero-install (Node 18+). Prints progress every page, writes partial results
// every N new feeds so you’re never staring at a blank file.
//
// Examples (PowerShell, one line each):
//   node scripts/cse-fast.js --platform linkedin --api-keys KEY --cxs CX \
//     --base https://YOUR-RSSHUB --access-key YOUR_ACCESS --max 120 --pages 1 \
//     --max-queries 80 --emit-every 20 --sleep 150 --geo NA --debug
//
//   node scripts/cse-fast.js --platform instagram --api-keys KEY --cxs CX \
//     --base https://YOUR-RSSHUB --access-key YOUR_ACCESS --max 200 --pages 2 \
//     --emit-every 25 --sleep 150 --geo NA --debug
//
// Output files in current folder:
//   rsshub_feeds.txt  → paste/append into Render env RSSHUB_FEEDS
//   native_feeds.txt  → paste/append into Render env FEEDS_NATIVE

function args(){ const a=process.argv.slice(2),o={}; for(let i=0;i<a.length;i++){const k=a[i]; if(k.startsWith('--')){const K=k.slice(2); const v=(i+1<a.length&&!a[i+1].startsWith('--'))?a[++i]:'true'; o[K]=v;}} return o; }
const A=args();

const PLATFORM=(A.platform||'linkedin').toLowerCase(); // linkedin|instagram|threads|youtube|twitter|etsy|reddit
const API_KEYS=(A['api-keys']||'').split(',').map(s=>s.trim()).filter(Boolean);
const CXS=(A.cxs||'').split(',').map(s=>s.trim()).filter(Boolean);
const BASE=(A.base||'').replace(/\/$/,'');
const ACCESS=(A['access-key']||'').trim();
const MAX_RESULTS=Number(A.max||200);
const PAGES_PER_QUERY=Math.max(1,Math.min(10,Number(A.pages||1)));
const SLEEP_MS=Math.max(50,Number(A.sleep||150));
const GEO=(A.geo||'NA').toUpperCase(); // US|CA|NA|ALL
const MAX_QUERIES=Math.max(1,Number(A['max-queries']||300));
const EMIT_EVERY=Math.max(5,Number(A['emit-every']||25));
const DEBUG=(String(A.debug||'false').toLowerCase()==='true');

if(!API_KEYS.length||!CXS.length){ console.error('[fast] Missing --api-keys or --cxs'); process.exit(1); }
if(!BASE||!ACCESS){ console.error('[fast] Missing --base or --access-key'); process.exit(1); }

// ------------ seeds (ASCII only), same as earlier scripts -------------
const SUPPLIER_CATEGORIES=["packaging manufacturer","packaging supplier","packaging converter","corrugated boxes manufacturer","folding carton","rigid box","paperboard","labels manufacturer","thermal transfer labels","ghs labels","rfid labels","shrink sleeve labels","flexible packaging film","laminate film","rollstock","stand up pouches supplier","spouted pouch","retort pouch","mono material","protective packaging","void fill","foam in place","edge protectors","crating","ispm 15 pallets","export pallets","skids","digital printing packaging","flexo printing","gravure printing","offset printing","co packer","contract packaging","display pop packaging","kitting","3pl","sustainable packaging","compostable packaging","recyclable packaging","pcr packaging"]; 
const BUYER_SECTORS=["food brand","beverage brand","beer brand","craft brewery","coffee roaster","confectionery","frozen foods","meal kit","pet food brand","pet treats","cosmetics brand","beauty brand","personal care brand","fragrance brand","dietary supplements brand","nutraceutical brand","household goods brand","home care brand","electronics accessories brand","small appliance brand","cannabis brand","cbd brand","dtc brand","e commerce brand","subscription box brand"]; 
const NAICS_TERMS=["NAICS 3222","NAICS 322211","NAICS 322219","NAICS 326111","NAICS 326112","NAICS 333993","NAICS 561910"]; 
const PROCUREMENT_TERMS=["procurement","sourcing","purchasing","buyer","supply chain","vendor management"]; 
const US_STATES=["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"]; 
const CA_PROV=["Ontario","Quebec","British Columbia","Alberta","Manitoba","Saskatchewan","Nova Scotia","New Brunswick","Newfoundland","Prince Edward Island"]; 

function geos(){ if(GEO==='US')return['United States','USA',...US_STATES]; if(GEO==='CA')return['Canada',...CA_PROV]; if(GEO==='ALL')return[]; return ['United States','USA','Canada','North America']; }

function makeQueries(){
  const out=new Set(); const dmap={linkedin:'site:linkedin.com/company',instagram:'site:instagram.com',threads:'site:threads.net',youtube:'site:youtube.com',twitter:'site:twitter.com OR site:x.com',etsy:'site:etsy.com/shop',reddit:'site:reddit.com/r'}; 
  const dom = dmap[PLATFORM]||dmap.linkedin; const g=geos();
  function add(base){ if(!g.length) out.add(base); else for(const x of g) out.add(base+' '+x); }
  for(const kw of SUPPLIER_CATEGORIES) add(dom+' '+kw);
  for(const sec of BUYER_SECTORS) add(dom+' '+sec);
  for(const n of NAICS_TERMS) add(dom+' '+n);
  for(const sec of BUYER_SECTORS) for(const p of PROCUREMENT_TERMS) add(dom+' '+sec+' '+p);
  return Array.from(out);
}

let keyi=0,cxi=0; function nextKey(){const v=API_KEYS[keyi%API_KEYS.length]; keyi++; return v;} function nextCx(){const v=CXS[cxi%CXS.length]; cxi++; return v; }
async function cse(q,start,key,cx){ const u='https://www.googleapis.com/customsearch/v1?key='+encodeURIComponent(key)+'&cx='+encodeURIComponent(cx)+'&q='+encodeURIComponent(q)+'&num=10&start='+start; const r=await fetch(u); if(DEBUG) console.error(`[cse] ${r.status} ${q.slice(0,60)}...`); if(!r.ok) throw new Error('CSE '+r.status); return r.json(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function extractLinkedInCompany(u){ try{ const url=new URL(u); if(!/linkedin\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const seg=url.pathname.split('/').filter(Boolean); const i=seg.indexOf('company'); if(i===-1||i===seg.length-1)return null; return seg[i+1].replace(/[^a-zA-Z0-9_-]/g,''); }catch{return null;} }
function extractInstagram(u){ try{ const url=new URL(u); if(!/instagram\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const s=url.pathname.split('/').filter(Boolean)[0]||''; if(['p','reel','explore','stories'].includes(s))return null; return s.length>1&&s.length<32?s:null; }catch{return null;} }
function extractThreads(u){ try{ const url=new URL(u); if(!/threads\.net$/.test(url.hostname.replace(/^www\./,''))) return null; let s=(url.pathname.split('/').filter(Boolean)[0]||''); if(s.startsWith('@')) s=s.slice(1); return s||null; }catch{return null;} }
function extractYouTube(u){ try{ const url=new URL(u); if(!/youtube\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const seg=url.pathname.split('/').filter(Boolean); if(seg[0]==='@') return {type:'user',value:'@'+seg[0].slice(1)}; if(seg[0]==='channel'&&seg[1]) return {type:'channel',value:seg[1]}; if(seg[0]==='user'&&seg[1]) return {type:'user',value:seg[1]}; if(seg[0]==='c'&&seg[1]) return {type:'user',value:seg[1]}; return null; }catch{return null;} }
function extractTwitter(u){ try{ const url=new URL(u); if(!/(twitter|x)\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const first=(url.pathname.split('/').filter(Boolean)[0]||''); if(['i','intent','hashtag','search','home'].includes(first)) return null; return first&&first.length<32?first:null; }catch{return null;} }
function extractEtsy(u){ try{ const url=new URL(u); if(!/etsy\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const seg=url.pathname.split('/').filter(Boolean); return (seg[0]==='shop'&&seg[1])?seg[1]:null; }catch{return null;} }
function extractReddit(u){ try{ const url=new URL(u); if(!/reddit\.com$/.test(url.hostname.replace(/^www\./,''))) return null; const seg=url.pathname.split('/').filter(Boolean); return (seg[0]==='r'&&seg[1])?seg[1]:null; }catch{return null;} }

function bLinkedIn(slug){ return `${BASE}/linkedin/company/${encodeURIComponent(slug)}/posts?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function bPicnob(h){ return `${BASE}/picnob/user/${encodeURIComponent(h)}?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function bPicuki(h){ return `${BASE}/picuki/profile/${encodeURIComponent(h)}?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function bThreads(h){ return `${BASE}/threads/${encodeURIComponent(h)}?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function bYtUser(u){ return `${BASE}/youtube/user/${encodeURIComponent(u)}?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function bYtChan(id){ return `${BASE}/youtube/channel/${encodeURIComponent(id)}?key=${encodeURIComponent(ACCESS)}&limit=20`; }
function nNitter(h){ return `https://nitter.net/${encodeURIComponent(h)}/rss`; }
function nEtsy(s){ return `https://www.etsy.com/shop/${encodeURIComponent(s)}/rss`; }
function nReddit(sub){ return `https://www.reddit.com/r/${encodeURIComponent(sub)}/.rss`; }

const rsshub=new Set(); const native=new Set();
function emit(force=false){ if(!force && (rsshub.size+native.size)%EMIT_EVERY!==0) return; const fs=require('fs'); try{ fs.writeFileSync('rsshub_feeds.txt', Array.from(rsshub).join(',')); }catch{} try{ fs.writeFileSync('native_feeds.txt', Array.from(native).join(',')); }catch{} if(DEBUG) console.error(`[fast] emitted rsshub=${rsshub.size} native=${native.size}`); }

(async function main(){
  const queries=makeQueries(); console.error(`[fast] queries=${queries.length} pages=${PAGES_PER_QUERY}`);
  let qCount=0;
  outer: for(const q of queries){
    if(qCount>=MAX_QUERIES){ if(DEBUG) console.error('[fast] max-queries reached'); break; }
    qCount++;
    for(let p=0;p<PAGES_PER_QUERY;p++){
      const start=1+p*10; const key=nextKey(); const cx=nextCx();
      try{
        const data=await cse(q,start,key,cx); const items=(data&&data.items)||[]; if(DEBUG) console.error(`[fast] items=${items.length}`);
        for(const it of items){
          const link=it.link||'';
          if(PLATFORM==='linkedin'){ const s=extractLinkedInCompany(link); if(s){ rsshub.add(bLinkedIn(s)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='instagram'){ const h=extractInstagram(link); if(h){ rsshub.add(bPicnob(h)); rsshub.add(bPicuki(h)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='threads'){ const h=extractThreads(link); if(h){ rsshub.add(bThreads(h)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='youtube'){ const yo=extractYouTube(link); if(yo){ if(yo.type==='user') rsshub.add(bYtUser(yo.value)); else rsshub.add(bYtChan(yo.value)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='twitter'){ const h=extractTwitter(link); if(h){ native.add(nNitter(h)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='etsy'){ const s=extractEtsy(link); if(s){ native.add(nEtsy(s)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
          if(PLATFORM==='reddit'){ const s=extractReddit(link); if(s){ native.add(nReddit(s)); emit(); if(rsshub.size+native.size>=MAX_RESULTS) break outer; } }
        }
      }catch(e){ if(DEBUG) console.error('[fast] error '+(e&&e.message?e.message:e)); }
      await sleep(SLEEP_MS);
    }
  }
  emit(true);
  console.error(`[fast] DONE rsshub=${rsshub.size} native=${native.size}`);
})();
