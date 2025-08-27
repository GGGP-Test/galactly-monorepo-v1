import fs from 'fs';
import path from 'path';
import https from 'https';
import { URL } from 'url';
import { q } from './db';

// ---- env & helpers ----
const API_KEY = process.env.GOOGLE_API_KEY || '';
const CXS = Object.keys(process.env)
  .filter(k => k.startsWith('GOOGLE_CX_') && (process.env[k]||'').trim().length)
  .map(k => String(process.env[k]).trim());

const COMPANY_FILE = process.env.CSE_COMPANY_FILE || '';
const QUERIES_FILE  = process.env.CSE_QUERIES_FILE  || '';

function readLines(file?: string){
  try{ if(!file) return []; const p = path.resolve(file); if(!fs.existsSync(p)) return []; return fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}catch{ return []; }
}

function pick<T>(a: T[]): T { return a[Math.floor(Math.random()*a.length)]; }

function httpGetJson<T=any>(u: string): Promise<T>{
  return new Promise((resolve,reject)=>{
    const url = new URL(u);
    https.get({ hostname:url.hostname, path:url.pathname+url.search, protocol:url.protocol, headers:{'User-Agent':'galactly/1.0'} }, (res)=>{
      const chunks: Buffer[] = [];
      res.on('data', c=>chunks.push(c));
      res.on('end', ()=>{
        try{ const body = Buffer.concat(chunks).toString('utf8'); const json = JSON.parse(body); resolve(json as T); }
        catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}

async function upsertLead(item: { url:string; title?:string; snippet?:string; platform?:string; ttlMin?:number }){
  const { url, title, snippet } = item;
  await q(
    `INSERT INTO lead_pool (platform, source_url, title, snippet, ttl, state)
     VALUES ($1,$2,$3,$4, now() + interval '120 minutes', 'available')
     ON CONFLICT (source_url) DO UPDATE SET title=EXCLUDED.title, snippet=EXCLUDED.snippet, ttl=now() + interval '120 minutes'`,
    [item.platform||'web', url, title||null, snippet||null]
  );
}

// build query for a brand domain
function queryForDomain(domain: string, extra?: string){
  const base = `site:${domain} (supplier OR vendors OR procurement OR sourcing OR "vendor registration" OR rfq OR rfi)`;
  return extra ? `${base} ${extra}` : base;
}

async function searchOnce(cx: string, qStr: string, num=5){
  const qParam = encodeURIComponent(qStr);
  const u = `https://www.googleapis.com/customsearch/v1?key=${API_KEY}&cx=${encodeURIComponent(cx)}&q=${qParam}&num=${num}`;
  type GItem = { title?:string; link?:string; snippet?:string; displayLink?:string };
  const data = await httpGetJson<{ items?: GItem[] }>(u);
  return (data.items||[]).map(it=>({
    url: it.link || '',
    title: it.title || '',
    snippet: it.snippet || '',
    platform: 'web'
  })).filter(r=>r.url);
}

export async function runIngest(source: string){
  // Only CSE is implemented here ("rss"/"social" no-ops for now)
  const wantCse = source === 'all' || source === 'cse';
  if(!wantCse) return { ok:true, ran: [] } as const;

  if(!API_KEY || !CXS.length) return { ok:false, error:'missing GOOGLE_API_KEY or GOOGLE_CX_*' } as const;

  const companies = readLines(COMPANY_FILE);
  if(!companies.length) return { ok:false, error:'company file empty (set CSE_COMPANY_FILE to mounted list)' } as const;

  const extras = readLines(QUERIES_FILE);
  const extra = extras.length ? `(${extras.slice(0,6).join(' OR ')})` : '(packaging OR corrugated OR carton OR labels)';

  let inserted = 0, scanned = 0;
  const cxRoundRobin = [...CXS]; let cxIdx = 0;

  for(const domain of companies.slice(0, 50)){ // safety cap per run
    scanned++;
    const qStr = queryForDomain(domain, extra);
    const cx = cxRoundRobin[cxIdx++ % cxRoundRobin.length];
    try{
      const items = await searchOnce(cx, qStr, Number(process.env.CSE_RESULTS_PER_QUERY||'5'));
      for(const it of items){ await upsertLead(it); inserted++; }
      await new Promise(r=>setTimeout(r, Number(process.env.CSE_SLEEP_MS||'250')));
    }catch(e){ /* continue */ }
  }

  return { ok:true, ran:['cse'], scanned, inserted } as const;
}
