import fetch from 'node-fetch';
import { classify, heatFromSource, fitScore } from '../util.js';
import { db, insertLead } from '../db.js';

const QUERIES = [
  'need custom boxes', 'looking for packaging supplier', 'quote for labels', 'custom mailer boxes', 'stand up pouches supplier', 'pallet crates quote'
];

export async function pollReddit(){
  if(process.env.REDDIT_ENABLED !== 'true') return;
  for(const q of QUERIES){
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&t=day`;
    const r = await fetch(url, { headers: { 'User-Agent': 'GalactlyLeadFinder/1.0' }});
    if(!r.ok) continue;
    const data:any = await r.json();
    const posts = data.data?.children || [];
    for(const p of posts){
      const post = p.data; if(!post) continue;
      const title = post.title || '';
      const self = post.selftext || '';
      const text = `${title} ${self}`;
      const { cat, kw } = classify(text);
      const lead = {
        cat, kw,
        platform: 'Reddit',
        region: 'US' as const,
        fit_user: fitScore(78),
        fit_competition: fitScore(82, 2),
        heat: heatFromSource('reddit'),
        source_url: `https://reddit.com${post.permalink}`,
        evidence_snippet: self.slice(0, 180) || title,
        generated_at: Date.now(),
        expires_at: Date.now()+ 48*3600*1000,
        state: 'available' as const,
        reserved_by: null,
        reserved_until: null,
        company: null,
        person_handle: post.author,
        contact_email: null
      };
      const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=?`).get(lead.source_url);
      if(!exists) insertLead(lead as any);
    }
  }
}
