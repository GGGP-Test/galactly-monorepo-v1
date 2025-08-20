// File: src/connectors/socialFirehose.ts
// Purpose: Pull near‑real‑time buyer‑intent from compliant sources (no RSS.app).
// Sources (all optional, toggle by env):
//  • X (Twitter): snscrape CLI if available; else HTTP microservice (SNS_SERVICE_URL); else Apify actor
//  • Instagram: RSSHub routes (self‑hosted) via RSSHUB_FEEDS
//  • LinkedIn: Google CSE connector (handled in googleCse.ts)
//  • Reddit/YouTube/Threads/Bluesky/Generic: RSSHub + native RSS via FEEDS_NATIVE
//  • Webz.io: News API Lite (webz) via WEBZ_TOKEN (already implemented in previous module)
//
// Env:
//   SNSCRAPE_CMD=/usr/local/bin/snscrape   # if Docker path set
//   SNS_SERVICE_URL=https://snservice.onrender.com  # Python microservice fallback
//   APIFY_TOKEN=...                         # final fallback for X (actor)
//   APIFY_X_ACTOR_ID=xtdata~twitter-x-scraper
//   RSSHUB_FEEDS=https://your-rsshub/instagram/tag/customboxes?key=K,...
//   FEEDS_NATIVE=https://www.reddit.com/search.rss?q=...,https://www.youtube.com/feeds/videos.xml?channel_id=...
//   REGION_DEFAULT=US|Canada|Other

import fetch from 'node-fetch';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import Parser from 'rss-parser';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

const exec = promisify(execCb);
const parser = new Parser();

// ---- ENV ----
const SNSCRAPE_CMD = process.env.SNSCRAPE_CMD || '';
const SNS_SERVICE_URL = process.env.SNS_SERVICE_URL || '';
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const APIFY_X_ACTOR = process.env.APIFY_X_ACTOR_ID || 'xtdata~twitter-x-scraper';

const RSSHUB_FEEDS = (process.env.RSSHUB_FEEDS || '').split(',').map(s=>s.trim()).filter(Boolean);
const FEEDS_NATIVE = (process.env.FEEDS_NATIVE || '').split(',').map(s=>s.trim()).filter(Boolean);
const REGION_DEFAULT: 'US' | 'Canada' | 'Other' = (process.env.REGION_DEFAULT as any) || 'US';

// ---- helpers ----
function toEpochMillis(x: any): number { try{ const t = new Date(x).getTime(); return Number.isFinite(t)?t:Date.now(); }catch{ return Date.now(); } }
function withinDays(ts: number, d: number){ return ts >= Date.now() - d*24*3600*1000; }
function inferIntent(t: string){
  const s = (t||'').toLowerCase();
  if(/\brfq\b|\brfp\b|request for (?:quote|proposal)|\bquote for\b|tender|bid|\bmoq\b|qty\s*\d{2,}/.test(s)) return { intent:'HOT' as const, bump:12 };
  if(/looking for (?:a )?supplier|need (?:.*)?packaging|estimate|pricing/.test(s)) return { intent:'WARM' as const, bump:5 };
  return { intent:'OK' as const, bump:0 };
}

async function saveLead(opts: { text: string; url: string; platform: string; posted?: number; region?: 'US'|'Canada'|'Other' }){
  const { text, url, platform } = opts;
  if(!url) return;
  const recent = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at>?`).get(url, Date.now()-3*24*3600*1000);
  if(recent) return;
  const { cat, kw } = classify(text);
  const { intent, bump } = inferIntent(text);
  const base = intent==='HOT'?86:intent==='WARM'?78:72;
  const fit_user = fitScore(base + bump);
  const fit_competition = fitScore(base + 3);
  const generated_at = opts.posted || Date.now();
  if(!withinDays(generated_at, 60)) return;

  insertLead({
    cat, kw, platform,
    region: opts.region || REGION_DEFAULT,
    fit_user, fit_competition,
    heat: heatFromSource(platform),
    source_url: url,
    evidence_snippet: text.slice(0,240),
    generated_at,
    expires_at: generated_at + 72*3600*1000,
    state: 'available', reserved_by: null, reserved_until: null,
    company: null, person_handle: null, contact_email: null
  } as any);
  db.prepare(`UPDATE lead_pool SET intent_type=?, lead_score=? WHERE source_url=?`).run(
    intent, Math.min(99, fit_user + (intent==='HOT'?5:intent==='WARM'?2:0)), url
  );
}

// ---- X (Twitter) search flow: snscrape -> HTTP microservice -> Apify ----
async function pollX(queries: string[]){
  for(const q of queries){
    // A) local CLI
    if(SNSCRAPE_CMD){
      try{
        const cmd = `${SNSCRAPE_CMD} --jsonl --max-results 30 twitter-search "${q}"`;
        const { stdout } = await exec(cmd);
        for(const line of stdout.split(/\r?\n/).filter(Boolean)){
          try{
            const it = JSON.parse(line);
            const text = it.content || it.full_text || it.renderedContent || '';
            const url = it.url || it.link || '';
            if(url && text) await saveLead({ text, url, platform: 'X', posted: toEpochMillis(it.date) });
          }catch{}
        }
        continue; // next query
      }catch{ /* fall through */ }
    }

    // B) HTTP microservice fallback
    if(SNS_SERVICE_URL){
      try{
        const items:any[] = await fetch(`${SNS_SERVICE_URL}/x/search?q=${encodeURIComponent(q)}&max_results=30`).then(r=>r.json());
        for(const it of items){
          const text = it.content || it.full_text || it.renderedContent || it.text || '';
          const url = it.url || it.link || it.tweetUrl || '';
          if(url && text) await saveLead({ text, url, platform: 'X', posted: toEpochMillis(it.date || it.created_at) });
        }
        continue;
      }catch{ /* fall through */ }
    }

    // C) Apify fallback
    if(APIFY_TOKEN){
      try{
        const run = await fetch(`https://api.apify.com/v2/acts/${APIFY_X_ACTOR}/runs?token=${APIFY_TOKEN}`,{
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ searchTerms:[q], mode:'search', maxItems:20 })
        }).then(r=>r.json());
        const did = run?.data?.defaultDatasetId; if(!did) continue;
        const items:any[] = await fetch(`https://api.apify.com/v2/datasets/${did}/items?format=json&clean=1`).then(r=>r.json()).catch(()=>[]);
        for(const it of items){
          const text = it.full_text || it.text || it.title || '';
          const url = it.url || it.tweetUrl || it.link || '';
          if(url && text) await saveLead({ text, url, platform:'X', posted: toEpochMillis(it.created_at||it.createdAt) });
        }
      }catch{ /* ignore */ }
    }
  }
}

// ---- RSSHub + native RSS ----
async function pollFeeds(urls: string[], label: string){
  for(const u of urls){
    try{
      const feed = await parser.parseURL(u);
      for(const it of feed.items){
        const text = `${it.title||''} ${it.contentSnippet||it.content||''}`.trim();
        const link = it.link || '';
        const t = toEpochMillis((it as any).isoDate || (it as any).pubDate || (it as any).date || Date.now());
        if(text && link) await saveLead({ text, url: link, platform: label, posted: t });
      }
    }catch{ /* ignore bad feed */ }
  }
}

export async function pollSocialFirehose(){
  const X_QUERIES = (process.env.X_QUERIES || 'need packaging,packaging supplier,quote for boxes,rfq packaging').split(',').map(s=>s.trim()).filter(Boolean);
  await Promise.allSettled([
    pollX(X_QUERIES),
    pollFeeds(RSSHUB_FEEDS, 'RSSHub'),
    pollFeeds(FEEDS_NATIVE, 'RSS')
  ]);
}
