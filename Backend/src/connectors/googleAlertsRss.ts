// File: src/connectors/googleAlertsRss.ts
// Purpose: Ingest Google Alerts RSS feeds (and optional Google News query RSS) into lead_pool.
// Notes: Zero API keys. Pairs with IMAP watcher (email alerts), but works standalone too.
 // @ts-nocheck

import Parser from 'rss-parser';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

const parser = new Parser();

// ===== ENV =====
// ALERTS_RSS_URLS=https://alerts.google.com/alerts/feeds/xxx,https://alerts.google.com/alerts/feeds/yyy
//   (Create Google Alert → Deliver to: RSS → copy the feed URL; paste here, comma-separated)
// ALERTS_KEYWORDS=packaging,labels,corrugated,carton,pouch,pouches,stand up pouch,mailer,crate,pallet,rfq,rfp,request for quote,request for proposal,procurement,buyer,sourcing,co-pack,co pack,kitting,ghs,thermal transfer,direct thermal,rollstock,laminate,film,retort,zipper,die-cut,folding carton,sbs,kraft,litho-lam,flexo,digital,offset,gravure,compostable,recyclable,pcr,mono-material,shrink sleeve
// ALERTS_REGION=US  // or Canada / Other
//
// Optional fallback (if you prefer not creating RSS alerts yet):
// NEWS_QUERIES="need packaging supplier, custom packaging quote, rfq packaging, corrugated boxes supplier, label printer quote"

const ALERT_FEEDS = (process.env.ALERTS_RSS_URLS||'')
  .split(',').map(s=>s.trim()).filter(Boolean);

const NEWS_QUERIES = (process.env.NEWS_QUERIES||'')
  .split(',').map(s=>s.trim()).filter(Boolean);

const KW = (process.env.ALERTS_KEYWORDS||
  'packaging,labels,corrugated,carton,pouch,pouches,stand up pouch,mailer,crate,pallet,rfq,rfp,request for quote,request for proposal,procurement,buyer,sourcing,co-pack,co pack,kitting,ghs,thermal transfer,direct thermal,rollstock,laminate,film,retort,zipper,die-cut,folding carton,sbs,kraft,litho-lam,flexo,digital,offset,gravure,compostable,recyclable,pcr,mono-material,shrink sleeve'
).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);

const REGION = (process.env.ALERTS_REGION||'US') as 'US'|'Canada'|'Other';

function matches(text:string){
  const t = text.toLowerCase();
  return KW.some(k => t.includes(k));
}

function gnews(q:string){
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
}

export async function pollGoogleAlertsRss(){
  const feeds: Array<{ url:string; platform:string }> = [];
  for(const u of ALERT_FEEDS){ feeds.push({ url:u, platform:'GoogleAlerts' }); }
  for(const q of NEWS_QUERIES){ feeds.push({ url:gnews(q), platform:'NewsRSS' }); }
  if(!feeds.length){
    console.warn('[googleAlertsRss] No ALERTS_RSS_URLS or NEWS_QUERIES configured — skipping');
    return;
  }

  for(const f of feeds){
    try{
      const feed = await parser.parseURL(f.url);
      for(const item of feed.items||[]){
        const title = (item.title||'').trim();
        const body  = (item.contentSnippet||item.content||'').toString();
        const text  = `${title} ${body}`;
        if(!matches(text)) continue;
        const { cat, kw } = classify(text);
        const link = (item.link||'').trim();
        if(!link) continue;

        const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`).get(link, Date.now()-3*24*3600*1000);
        if(exists) continue;

        const lead = {
          cat, kw,
          platform: f.platform,
          region: REGION,
          fit_user: fitScore(74),
          fit_competition: fitScore(80),
          heat: heatFromSource('alerts'),
          source_url: link,
          evidence_snippet: body.slice(0,180),
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
    }catch(e){
      console.warn('[googleAlertsRss] feed error', f.platform, f.url, (e as any)?.message||e);
    }
  }
}
