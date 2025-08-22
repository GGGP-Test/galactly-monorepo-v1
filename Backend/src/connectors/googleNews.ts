import Parser from 'rss-parser';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore } from '../util.js';

const parser = new Parser();
const QUERIES = (process.env.NEWS_QUERIES||'').split(',').map(s=>s.trim()).filter(Boolean);

function feedUrl(q:string){
  // Google News RSS for a query
  return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-US&gl=US&ceid=US:en';
}

export async function pollGoogleNews(){
  if(!QUERIES.length) return;
  for(const q of QUERIES){
    const url = feedUrl(q);
    try{
      const feed = await parser.parseURL(url);
      for(const item of (feed.items||[])){
        const text = `${item.title||''} ${item.contentSnippet||''}`;
        const { cat, kw } = classify(text);
        const src = (item.link||'').trim();
        if(!src) continue;
        const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`)
          .get(src, Date.now()-3*24*3600*1000);
        if(exists) continue;

        const lead = {
          cat, kw,
          platform: 'NewsRSS',
          region: 'US' as const, // heuristic; refine with item.source if needed
          fit_user: fitScore(70),
          fit_competition: fitScore(78),
          heat: heatFromSource('news'),
          source_url: src,
          evidence_snippet: (item.contentSnippet||'').slice(0,180),
          generated_at: Date.now(),
          expires_at: Date.now()+72*3600*1000,
          state: 'available' as const,
          reserved_by: null,
          reserved_until: null,
          company: null,
          person_handle: null,
          contact_email: null
        };
        await insertLead(lead as any);
      }
    }catch{ /* ignore bad feeds */ }
  }
}
