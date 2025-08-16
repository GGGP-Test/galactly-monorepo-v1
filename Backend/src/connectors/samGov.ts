import fetch from 'node-fetch';
import { classify, heatFromSource, fitScore } from '../util.js';
import { db, insertLead } from '../db.js';

const KEY = process.env.SAM_API_KEY;
const BASE = 'https://api.sam.gov/opportunities/v2/search';

export async function pollSamGov(){
  if(!KEY) return;
  const now = new Date();
  const to = now.toLocaleDateString('en-US');
  const from = new Date(now.getTime() - 1000*60*60*24).toLocaleDateString('en-US');
  const params = new URLSearchParams({ api_key: KEY, postedFrom: from, postedTo: to, limit: '100' });
  const url = `${BASE}?${params.toString()}`;
  const r = await fetch(url);
  if(!r.ok) return;
  const data: any = await r.json();
  const items = data.opportunities || [];
  for(const opp of items){
    const title = opp.title || '';
    const desc = opp.description || opp.synopsis || '';
    const text = `${title} ${desc}`;
    const { cat, kw } = classify(text);
    const lead = {
      cat, kw,
      platform: 'SAM.gov',
      region: 'US' as const,
      fit_user: fitScore(85),
      fit_competition: fitScore(90, 2),
      heat: heatFromSource('sam.gov'),
      source_url: opp.uiLink || opp.url || '',
      evidence_snippet: (desc||title).slice(0, 180),
      generated_at: Date.now(),
      expires_at: Date.now()+ 72*3600*1000,
      state: 'available' as const,
      reserved_by: null,
      reserved_until: null,
      company: (opp.organizationName || opp.department || null),
      person_handle: null,
      contact_email: (opp.pointOfContact && opp.pointOfContact[0]?.email) || null
    };
    // dedupe by source_url within 3 days
    const exists = db.prepare(`SELECT 1 FROM lead_pool WHERE source_url=? AND generated_at > ?`).get(lead.source_url, Date.now()-3*24*3600*1000);
    if(!exists && lead.source_url){ insertLead(lead as any); }
  }
}
