import fetch from 'node-fetch';
import { db, insertLead } from '../db.js';
import { classify, heatFromSource, fitScore, clamp } from '../util.js';

const KEY = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';
if (!KEY) console.warn('[youtube] No YOUTUBE_API_KEY set');

const QUERIES = [
  'need packaging supplier',
  'custom boxes supplier',
  'stand up pouch supplier',
  'labels printing quote',
  'pallet crates export'
];

const BASE = 'https://www.googleapis.com/youtube/v3';

async function yt(path: string, params: Record<string,string>) {
  const u = new URL(BASE + path);
  Object.entries({ key: KEY, ...params }).forEach(([k,v])=> u.searchParams.set(k,v));
  const r = await fetch(u.toString());
  if(!r.ok) throw new Error('YT API ' + r.status);
  return r.json();
}

export async function pollYouTube(){
  if(!KEY) return;
  for(const q of QUERIES){
    try{
      // 1) Search recent videos for the query
      const search:any = await yt('/search', {
        part:'snippet',
        q: q,
        maxResults:'10',
        order:'date',
        type:'video',
        publishedAfter: new Date(Date.now()-48*3600*1000).toISOString()
      });
      const videos = (search.items||[]).map((i:any)=>({ id:i.id.videoId, title:i.snippet.title||'', desc:i.snippet.description||'' }));
      for(const v of videos){
        // 2) Pull top-level comments (if any)
        const cdata:any = await yt('/commentThreads', {
          part:'snippet',
          videoId: v.id,
          maxResults:'20',
          order:'time'
        }).catch(()=>({items:[]}));

        const texts:string[] = [];
        texts.push(v.title, v.desc);
        (cdata.items||[]).forEach((it:any)=>{
          const top = it.snippet?.topLevelComment?.snippet;
          if(top?.textDisplay) texts.push(top.textDisplay);
        });

        const text = texts.join(' ');
        const { cat, kw } = classify(text);
        const srcUrl = 'https://www.youtube.com/watch?v=' + v.id;
        const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`).get(srcUrl, Date.now()-3*24*3600*1000);
        if(exists) continue;

        const lead = {
          cat, kw,
          platform: 'YouTube',
          region: 'US' as const, // heuristic; refine later by channel location
          fit_user: fitScore(76),
          fit_competition: fitScore(82,2),
          heat: heatFromSource('youtube'),
          source_url: srcUrl,
          evidence_snippet: text.slice(0,180),
          generated_at: Date.now(),
          expires_at: Date.now()+ 72*3600*1000,
          state: 'available' as const,
          reserved_by: null,
          reserved_until: null,
          company: null,
          person_handle: null,
          contact_email: null
        };
        insertLead(lead as any);
      }
    }catch(e){ /* ignore query errors */ }
  }
}
