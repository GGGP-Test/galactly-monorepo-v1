import Parser from 'rss-parser';
import { classify, heatFromSource, fitScore } from '../util.js';
import { db, insertLead } from '../db.js';
const parser = new Parser();

export async function pollRss(){
  const feeds = (process.env.RSS_FEEDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  for(const f of feeds){
    try{
      const feed = await parser.parseURL(f);
      for(const item of feed.items){
        const text = `${item.title||''} ${item.contentSnippet||''}`;
        const { cat, kw } = classify(text);
        const lead = {
          cat, kw,
          platform: 'RSS',
          region: 'US' as const,
          fit_user: fitScore(72),
          fit_competition: fitScore(78),
          heat: heatFromSource(f),
          source_url: item.link||'',
          evidence_snippet: (item.contentSnippet||'').slice(0,180),
          generated_at: Date.now(),
          expires_at: Date.now()+ 72*3600*1000,
          state: 'available' as const,
          reserved_by: null,
          reserved_until: null,
          company: null,
          person_handle: null,
          contact_email: null
        };
        if(!lead.source_url) continue;
        const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=?`).get(lead.source_url);
        if(!exists) insertLead(lead as any);
      }
    }catch{ /* ignore bad feeds */ }
  }
}
