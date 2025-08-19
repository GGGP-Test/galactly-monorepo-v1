// File: src/connectors/socialFirehose.ts
// Purpose: Pull near‑real‑time buyer‑intent signals from social/news sources that
//          are explicitly authorized or brokered via provider APIs/feeds.
//
// Sources covered (all optional, toggle by env):
//  • X (Twitter):   via snscrape CLI if available, otherwise Apify actor (xtdata/twitter-x-scraper)
//  • Instagram:     via Apify actor (apify/instagram-scraper)
//  • LinkedIn:      via Apify actor (community actors; requires APIFY_TOKEN)
//  • Facebook:      via Graph API for Groups you have access to (requires FB_ACCESS_TOKEN & group IDs)
//  • Webz.io:       News API Lite (free token) to capture PR/news/reviews/forums (packaging RFQ/RFP etc.)
//  • Social Searcher: unified social mentions API (paid) if key provided
//  • RSS-Bridge/RSS.app: handled elsewhere as generic RSS; included here for convenience if env is set
//  • TradeWheel:    handled via Webz.io site: filter or manually curated URLs via RSS feeds
//
// IMPORTANT: Only consume public data or data you are allowed to access. Honor each
// provider’s ToS. This module avoids headless scraping by default and prefers APIs/feeds.

import fetch from 'node-fetch';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

const exec = promisify(execCb);

// ---- ENV ----
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const APIFY_X_ACTOR = process.env.APIFY_X_ACTOR_ID || 'xtdata~twitter-x-scraper';
const APIFY_IG_ACTOR = process.env.APIFY_IG_ACTOR_ID || 'apify~instagram-scraper';
const APIFY_LI_ACTOR = process.env.APIFY_LI_ACTOR_ID || 'logical_scrapers~linkedin-profile-scraper';

const X_QUERIES = (process.env.X_QUERIES || 'need packaging,packaging supplier,quote for boxes,rfq packaging').split(',').map(s=>s.trim()).filter(Boolean);
const IG_HASHTAGS = (process.env.IG_HASHTAGS || 'packaging,customboxes,labels,rfq').split(',').map(s=>s.trim()).filter(Boolean);
const LI_KEYWORDS = (process.env.LI_KEYWORDS || 'looking for packaging,need packaging supplier,rfq packaging').split(',').map(s=>s.trim()).filter(Boolean);

const WEBZ_TOKEN = process.env.WEBZ_TOKEN || '';
const WEBZ_NEWS_QUERIES = (process.env.WEBZ_NEWS_QUERIES || 'title:(rfq OR rfp OR "request for quote") AND (packaging OR boxes OR labels OR pouches) AND (site:gov OR site:news)')
  .split('|').map(s=>s.trim()).filter(Boolean);

const SOCIAL_SEARCHER_KEY = process.env.SOCIAL_SEARCHER_KEY || '';
const SOCIAL_SEARCHER_QUERY = process.env.SOCIAL_SEARCHER_QUERY || '"need packaging" OR "packaging supplier" OR "quote for boxes"';

const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const FB_GROUP_IDS = (process.env.FB_GROUP_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);

const RSS_EXTRA_FEEDS = (process.env.RSS_BRIDGE_FEEDS || '').split(',').map(s=>s.trim()).filter(Boolean);

const REGION_DEFAULT: 'US' | 'Canada' | 'Other' = (process.env.REGION_DEFAULT as any) || 'US';

// ---- helpers ----
function hoursFromNow(h: number) { return Date.now() - h * 3600 * 1000; }
function withinDays(ts: number, d: number) { return ts >= Date.now() - d*24*3600*1000; }
function toEpochMillis(x: string | number | Date | undefined): number {
  if (!x) return Date.now();
  const t = typeof x === 'number' ? x : new Date(x).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function inferIntent(text: string): { intent: 'HOT'|'WARM'|'OK', scoreBump: number } {
  const t = text.toLowerCase();
  const hotRe = /(\brfq\b|\brfp\b|request for (?:quote|proposal)|\bquote for\b|need (?:packaging|boxes|labels)|looking for (?:supplier|vendor)|immediate order|qty\s*\d{2,}|moq\b)/;
  const warmRe = /(recommend (?:supplier|vendor)|pricing for|estimate|rough quote|who can make|any supplier)/;
  if (hotRe.test(t)) return { intent: 'HOT', scoreBump: 12 };
  if (warmRe.test(t)) return { intent: 'WARM', scoreBump: 5 };
  return { intent: 'OK', scoreBump: 0 };
}

async function saveLead(opts: {
  cat: string; kw: string; platform: string; region?: 'US'|'Canada'|'Other';
  src: string; snippet?: string; postedAt?: number; company?: string|null; handle?: string|null; email?: string|null;
}) {
  const generated_at = opts.postedAt || Date.now();
  if (!withinDays(generated_at, 60)) return; // age gate
  const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`).get(opts.src, Date.now()-3*24*3600*1000);
  if (exists) return;

  const { intent, scoreBump } = inferIntent(`${opts.kw} ${opts.snippet||''}`);
  const baseFit = intent === 'HOT' ? 86 : intent === 'WARM' ? 78 : 72;
  const fit_user = fitScore(baseFit + scoreBump);
  const fit_competition = fitScore(baseFit + 4, 2);

  insertLead({
    cat: opts.cat,
    kw: opts.kw,
    platform: opts.platform,
    region: opts.region || REGION_DEFAULT,
    fit_user,
    fit_competition,
    heat: heatFromSource(opts.platform),
    source_url: opts.src,
    evidence_snippet: (opts.snippet||'').slice(0, 220),
    generated_at,
    expires_at: generated_at + 72*3600*1000,
    state: 'available',
    reserved_by: null,
    reserved_until: null,
    company: opts.company || null,
    person_handle: opts.handle || null,
    contact_email: opts.email || null
  } as any);

  // Persist intent & score for new row
  db.prepare(`UPDATE lead_pool SET intent_type=?, lead_score=? WHERE source_url=?`).run(
    intent, Math.min(99, fit_user + (intent === 'HOT' ? 5 : intent === 'WARM' ? 2 : 0)), opts.src
  );
}

// ---- X (Twitter) via snscrape CLI (preferred if available), else Apify ----
async function pollX() {
  for (const q of X_QUERIES) {
    if (process.env.SNSCRAPE_CMD) {
      try {
        const cmd = `${process.env.SNSCRAPE_CMD} --jsonl --max-results 30 twitter-search "${q}"`;
        const { stdout } = await exec(cmd);
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const it = JSON.parse(line);
            const text: string = it.content || it.full_text || it.renderedContent || '';
            const url: string = it.url || it.link || '';
            if (!url) continue;
            const { cat, kw } = classify(text);
            await saveLead({ cat, kw, platform: 'X', region: REGION_DEFAULT, src: url, snippet: text.slice(0,180), postedAt: toEpochMillis(it.date), handle: it.user?.username || it.user?.id });
          } catch { /* ignore bad line */ }
        }
        continue; // next query
      } catch { /* fall back to Apify */ }
    }

    if (!APIFY_TOKEN) continue; // nothing to do
    // Apify: xtdata/twitter-x-scraper or twitterapi/twitter-search
    try {
      const run = await fetch(`https://api.apify.com/v2/acts/${APIFY_X_ACTOR}/runs?token=${APIFY_TOKEN}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerms: [q], mode: 'search', maxItems: 20 })
      }).then(r=>r.json());
      const did = run?.data?.defaultDatasetId;
      if (!did) continue;
      const items = await fetch(`https://api.apify.com/v2/datasets/${did}/items?format=json&clean=1`)
        .then(r=>r.json()).catch(()=>[]);
      for (const it of items) {
        const text: string = it.full_text || it.text || it.title || '';
        const url: string = it.url || it.tweetUrl || it.link || '';
        if (!url || !text) continue;
        const { cat, kw } = classify(text);
        await saveLead({ cat, kw, platform: 'X', region: REGION_DEFAULT, src: url, snippet: text.slice(0,180), postedAt: toEpochMillis(it.created_at || it.createdAt), handle: it.user?.username || it.author || null });
      }
    } catch { /* ignore */ }
  }
}

// ---- Instagram via Apify ----
async function pollInstagram() {
  if (!APIFY_TOKEN) return;
  try {
    const input = { hashtags: IG_HASHTAGS, resultsLimit: 20 };
    const run = await fetch(`https://api.apify.com/v2/acts/${APIFY_IG_ACTOR}/runs?token=${APIFY_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    }).then(r=>r.json());
    const did = run?.data?.defaultDatasetId;
    if (!did) return;
    const items = await fetch(`https://api.apify.com/v2/datasets/${did}/items?format=json&clean=1`).then(r=>r.json()).catch(()=>[]);
    for (const it of items) {
      const text: string = it.caption || it.text || '';
      const url: string = it.url || it.postUrl || '';
      if (!url || !text) continue;
      const { cat, kw } = classify(text);
      await saveLead({ cat, kw, platform: 'Instagram', src: url, snippet: text.slice(0,180), postedAt: toEpochMillis(it.timestamp || it.taken_at), handle: it.ownerUsername || it.username || null });
    }
  } catch { /* ignore */ }
}

// ---- LinkedIn via Apify actor (profile/post search variants) ----
async function pollLinkedIn() {
  if (!APIFY_TOKEN) return;
  for (const q of LI_KEYWORDS) {
    try {
      const run = await fetch(`https://api.apify.com/v2/acts/${APIFY_LI_ACTOR}/runs?token=${APIFY_TOKEN}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search: q, maxItems: 15 })
      }).then(r=>r.json());
      const did = run?.data?.defaultDatasetId;
      if (!did) continue;
      const items = await fetch(`https://api.apify.com/v2/datasets/${did}/items?format=json&clean=1`).then(r=>r.json()).catch(()=>[]);
      for (const it of items) {
        const text: string = it.headline || it.summary || it.description || it.text || '';
        const url: string = it.url || it.profileUrl || it.postUrl || '';
        if (!url || !text) continue;
        const { cat, kw } = classify(text);
        await saveLead({ cat, kw, platform: 'LinkedIn', src: url, snippet: text.slice(0,180), postedAt: toEpochMillis(it.publishedTime || it.updated_at), company: it.companyName || null, handle: it.username || it.author || null });
      }
    } catch { /* ignore */ }
  }
}

// ---- Facebook Groups via Graph API (requires access & permissions) ----
async function pollFacebookGroups() {
  if (!FB_ACCESS_TOKEN || FB_GROUP_IDS.length === 0) return;
  const version = process.env.FB_GRAPH_VERSION || 'v19.0';
  for (const gid of FB_GROUP_IDS) {
    try {
      const url = `https://graph.facebook.com/${version}/${gid}/feed?fields=message,created_time,permalink_url,from&limit=25&access_token=${encodeURIComponent(FB_ACCESS_TOKEN)}`;
      const data: any = await fetch(url).then(r=>r.json());
      const items = data?.data || [];
      for (const it of items) {
        const text: string = it.message || '';
        const urlp: string = it.permalink_url || '';
        if (!text || !urlp) continue;
        const { cat, kw } = classify(text);
        await saveLead({ cat, kw, platform: 'Facebook', src: urlp, snippet: text.slice(0,180), postedAt: toEpochMillis(it.created_time), handle: it.from?.name || null });
      }
    } catch { /* ignore */ }
  }
}

// ---- Webz.io News API Lite (free) ----
async function pollWebzNews() {
  if (!WEBZ_TOKEN) return;
  for (const q of WEBZ_NEWS_QUERIES) {
    try {
      const url = `https://api.webz.io/newsApiLite?token=${encodeURIComponent(WEBZ_TOKEN)}&q=${encodeURIComponent(q)}&sort=published`;
      const data: any = await fetch(url).then(r=>r.json());
      const posts = Array.isArray(data?.articles) ? data.articles : (data?.posts || []);
      for (const p of posts) {
        const title: string = p.title || '';
        const text: string = `${title} ${p.text || p.summary || ''}`.trim();
        const link: string = p.url || p.canonical_url || p.thread?.url || '';
        const published = toEpochMillis(p.published || p.publishedAt || p.thread?.published);
        if (!link || !text) continue;
        const { cat, kw } = classify(text);
        await saveLead({ cat, kw, platform: 'Webz.io', src: link, snippet: text.slice(0,220), postedAt: published, company: p.site || null });
      }
    } catch { /* ignore */ }
  }
}

// ---- Social Searcher API (paid) ----
async function pollSocialSearcher() {
  if (!SOCIAL_SEARCHER_KEY) return;
  try {
    const url = `https://api.social-searcher.com/v2/search?q=${encodeURIComponent(SOCIAL_SEARCHER_QUERY)}&key=${encodeURIComponent(SOCIAL_SEARCHER_KEY)}&network=facebook,twitter,instagram,reddit,youtube&limit=20`;
    const data: any = await fetch(url).then(r=>r.json());
    const posts = data?.posts || data?.data || [];
    for (const it of posts) {
      const text: string = it.text || it.message || it.title || '';
      const link: string = it.link || it.url || '';
      const src = (it.network || it.source || 'Social');
      if (!text || !link) continue;
      const { cat, kw } = classify(text);
      await saveLead({ cat, kw, platform: `Social:${src}`, src: link, snippet: text.slice(0,220), postedAt: toEpochMillis(it.posted || it.date) });
    }
  } catch { /* ignore */ }
}

// ---- RSS-Bridge / RSS.app extra feeds (if provided) ----
import Parser from 'rss-parser';
const parser = new Parser();
async function pollExtraFeeds() {
  for (const f of RSS_EXTRA_FEEDS) {
    try {
      const feed = await parser.parseURL(f);
      for (const item of feed.items) {
        const text = `${item.title||''} ${item.contentSnippet||item.content||''}`.trim();
        const link = item.link || '';
        if (!text || !link) continue;
        const { cat, kw } = classify(text);
        await saveLead({ cat, kw, platform: 'RSS-Bridge', src: link, snippet: text.slice(0,220), postedAt: toEpochMillis(item.isoDate || item.pubDate) });
      }
    } catch { /* ignore bad feed */ }
  }
}

export async function pollSocialFirehose(){
  await Promise.allSettled([
    pollX(),
    pollInstagram(),
    pollLinkedIn(),
    pollFacebookGroups(),
    pollWebzNews(),
    pollSocialSearcher(),
    pollExtraFeeds()
  ]);
}
