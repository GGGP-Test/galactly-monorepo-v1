import fetch from 'node-fetch';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

// Set env: JOB_COMPANIES="acme,packly,exampleco" (company slugs used by job boards)
// We'll try Greenhouse and Lever for each slug.

const PACKAGING_HINTS = [
  'packaging','corrugated','labels','pouch','pouches','stand up pouch','flexible','laminate','rollstock',
  'carton','mailer box','rsc','die-cut','crate','pallet','ispm','ghs','rfid','shrink','sleeve','label printer',
  'sourcing','procurement','buyer','supply chain','fulfillment','co-pack','co packing','kitting','dieline'
];

const GH = (slug:string)=> `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
const LEVER = (slug:string)=> `https://api.lever.co/v0/postings/${slug}?mode=json`;

function hasPackagingSignal(text:string){
  const t = text.toLowerCase();
  return PACKAGING_HINTS.some(k=> t.includes(k));
}

function regionFromLocation(loc?:string){
  const s = (loc||'').toLowerCase();
  if(/canada|toronto|vancouver|montreal|calgary|ontario|bc|quebec/.test(s)) return 'Canada';
  if(/usa|u\.s\.|united states|ny|ca |texas|illinois|ohio|florida|georgia|washington|colorado|boston|chicago|los angeles|seattle|austin|dallas|houston|miami/.test(s)) return 'US';
  return 'US';
}

async function fetchGH(slug:string){
  try{
    const r = await fetch(GH(slug)); if(!r.ok) return [] as any[];
    const data:any = await r.json();
    return (data.jobs||[]).map((j:any)=>({
      id: 'gh:'+j.id,
      title: j.title||'',
      text: `${j.title||''} ${(j.location?.name)||''} ${(j.content||'').replace(/<[^>]+>/g,' ')}`,
      url: j.absolute_url||'',
      location: j.location?.name||''
    }));
  }catch{return [] as any[]}
}

async function fetchLever(slug:string){
  try{
    const r = await fetch(LEVER(slug)); if(!r.ok) return [] as any[];
    const data:any[] = await r.json();
    return (data||[]).map((j:any)=>({
      id: 'lv:'+j.id,
      title: j.text||'',
      text: `${j.text||''} ${(j.categories?.location)||''} ${(j.descriptionPlain||'')}`,
      url: j.hostedUrl||j.applyUrl||'',
      location: (j.categories?.location)||''
    }));
  }catch{return [] as any[]}
}

export async function pollJobBoards(){
  const slugs = (process.env.JOB_COMPANIES||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!slugs.length) return;
  for(const slug of slugs){
    const items = [
      ...(await fetchGH(slug)),
      ...(await fetchLever(slug))
    ];
    for(const it of items){
      const txt = `${it.title} ${it.text}`;
      if(!hasPackagingSignal(txt)) continue; // only keep strong packaging signals
      const { cat, kw } = classify(txt);
      const src = it.url || '';
      if(!src) continue;
      const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`).get(src, Date.now()-3*24*3600*1000);
      if(exists) continue;

      const lead = {
        cat, kw,
        platform: it.id.startsWith('gh:') ? 'Greenhouse' : 'Lever',
        region: regionFromLocation(it.location) as 'US'|'Canada'|'Other',
        fit_user: fitScore(74),
        fit_competition: fitScore(80),
        heat: heatFromSource('jobs'),
        source_url: src,
        evidence_snippet: txt.slice(0,180),
        generated_at: Date.now(),
        expires_at: Date.now()+72*3600*1000,
        state: 'available' as const,
        reserved_by: null,
        reserved_until: null,
        company: null,
        person_handle: null,
        contact_email: null
      };
      insertLead(lead as any);
    }
  }
}
