// File: src/connectors/googleCse.ts
// Purpose: Search Google Programmable Search (CSE) for hot buyer‑intent posts on
//          specific social/market sites and insert normalized leads.
// Model:   Pull (no webhooks). Uses CSE API key + one or more CSE engines (cx).
// Env:
//   CSE_API_KEY=AIza...            (required)
//   CSE_CX=cx1[,cx2,...]           (required; one or more CSE engines)
//   CSE_QUERIES="need packaging, rfq packaging, \"request for quote\" packaging, quote for boxes, quote for labels, looking for supplier packaging"
//   CSE_SITES="linkedin.com,x.com,instagram.com,reddit.com,youtube.com,tradewheel.com,etsy.com,amazon.com"
//   REGION_DEFAULT=US|Canada|Other (optional, default US)
// Limits: Google CSE returns up to 10 results per page; we fetch up to 3 pages (30) per (cx,site,query).
// Dedupe: 3 days by source_url.
// Age: CSE has no publish date; we treat as "now" and rely on scoring/intent.

import fetch from 'node-fetch';
import { db, insertLead } from '../db.js';
import { classify, fitScore } from '../util.js';

const API_KEY = process.env.CSE_API_KEY || '';
const CXS = (process.env.CSE_CX || '').split(',').map(s=>s.trim()).filter(Boolean);
const QUERIES = (process.env.CSE_QUERIES || 'need packaging, rfq packaging, "request for quote" packaging, quote for boxes, quote for labels, looking for supplier packaging').split(',').map(s=>s.trim()).filter(Boolean);
const SITES = (process.env.CSE_SITES || 'linkedin.com,x.com,instagram.com,reddit.com,youtube.com,tradewheel.com,etsy.com,amazon.com').split(',').map(s=>s.trim()).filter(Boolean);
const REGION_DEFAULT: 'US'|'Canada'|'Other' = (process.env.REGION_DEFAULT as any) || 'US';

if (!API_KEY) console.warn('[googleCse] CSE_API_KEY missing');
if (!CXS.length) console.warn('[googleCse] CSE_CX missing');

const DAY = 24*3600*1000;

function toHost(u:string){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch{ return ''; } }
function hasDigits(s:string){ return /\d/.test(s||''); }

function inferIntentAndHeat(text:string, host:string){
  const t = (text||'').toLowerCase();
  const hot = /(\brfq\b|\brfp\b|request for (?:quote|proposal)|\bquote for\b|\btender\b|\bbid\b|\bmoq\b|qty\s*\d{2,})/i.test(t);
  const warm = /(need (?:.*)?packaging|looking for (?:a )?supplier|anyone (?:can )?make|estimate|pricing)/i.test(t);
  const h = host.toLowerCase();
  const siteHot = /(tradewheel\.com|craigslist\.org)/.test(h);
  const intent: 'HOT'|'WARM'|'OK' = hot || siteHot ? 'HOT' : warm ? 'WARM' : 'OK';
  const heat: 'HOT'|'WARM'|'OK' = intent;
  return { intent, heat };
}

async function save(url:string, title:string, snippet:string){
  if(!url) return;
  const recent = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at>?`).get(url, Date.now()-3*DAY);
  if(recent) return;

  const host = toHost(url);
  const text = `${title} ${snippet}`.trim();
  const { cat, kw } = classify(text);
  const { intent, heat } = inferIntentAndHeat(text, host);
  const base = intent==='HOT'?86:intent==='WARM'?78:72;
  const fit_user = fitScore(base + (hasDigits(text)?4:0));
  const fit_competition = fitScore(base + 3);

  insertLead({
    cat, kw,
    platform: `CSE:${host||'web'}`,
    region: REGION_DEFAULT,
    fit_user,
    fit_competition,
    heat,
    source_url: url,
    evidence_snippet: snippet?.slice(0,240) || title?.slice(0,240) || '',
    generated_at: Date.now(),
    expires_at: Date.now()+72*3600*1000,
    state: 'available',
    reserved_by: null,
    reserved_until: null,
    company: null,
    person_handle: null,
    contact_email: null
  } as any);

  db.prepare(`UPDATE lead_pool SET intent_type=?, lead_score=? WHERE source_url=?`).run(
    intent,
    Math.min(99, fit_user + (intent==='HOT'?5:intent==='WARM'?2:0)),
    url
  );
}

async function fetchPage(cx:string, q:string, start:number){
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(API_KEY)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(q)}&num=10&start=${start}`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`CSE ${r.status}`);
  return r.json() as Promise<any>;
}

export async function pollGoogleCSE(){
  if(!API_KEY || !CXS.length) return;
  const tasks: Array<Promise<void>> = [];

  for(const cx of CXS){
    for(const site of SITES){
      for(const baseQ of QUERIES){
        const q = `${baseQ} site:${site}`;
        for(const start of [1,11,21]){ // pages 1..3
          tasks.push((async()=>{
            try{
              const data = await fetchPage(cx, q, start);
              const items = data?.items || [];
              for(const it of items){
                const link = it.link || it.formattedUrl || '';
                const title = it.title || '';
                const snippet = it.snippet || '';
                await save(link, title, snippet);
              }
            }catch{ /* ignore quota/errors per page */ }
          })());
        }
      }
    }
  }

  // Throttle concurrency in chunks of 8
  const chunkSize = 8;
  for(let i=0; i<tasks.length; i+=chunkSize){
    await Promise.allSettled(tasks.slice(i, i+chunkSize));
  }
}
