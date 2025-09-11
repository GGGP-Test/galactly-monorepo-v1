// Backend/src/workers/webscout.ts
// WebScout: pulls candidate buyers from seeds + (optionally) LLM hints,
// then normalizes and scores them into your existing "why chip" style.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Types your routes/UI expect-ish
export type Temperature = 'hot' | 'warm';
export interface WhyChip {
  label: string;
  kind: 'meta' | 'platform' | 'signal' | 'geo' | 'recent' | 'packaging';
  score: number;     // 0..1
  detail: string;
}
export interface Candidate {
  host: string;          // "brand-x.com"
  title?: string;        // "RFQ: label refresh"
  platform?: string;     // "shopify" | "woocommerce" | "unknown"
  cat?: 'product' | 'procurement' | 'mixed';
  keywords?: string[];   // ["rfp","packaging","labels"]
  city?: string;
  region?: string;       // "CA", "NY", "ON", etc
  country?: string;      // "US", "CA"
  temperature: Temperature;
  why: WhyChip[];
}

export interface SupplierInput {
  supplierDomain: string;      // the packaging supplier (user) website
  persona?: string;            // optional buyer persona override
  region?: string;             // preferred city/region bias (e.g., "San Francisco" or "NJ")
  includeUSA?: boolean;        // default true
  includeCanada?: boolean;     // default true
  limit?: number;              // default 10
}

const US_CA = new Set(['US','USA','UNITED STATES','CA','CANADA']);

function onlyUSCA(country?: string): boolean {
  if (!country) return true; // if unknown, keep (LLM often omits country)
  return US_CA.has(country.toUpperCase());
}

function clamp(x: number, a=0, b=1){ return Math.max(a, Math.min(b, x)); }

function tldQuality(host: string): number {
  const tld = host.split('.').pop()?.toLowerCase() || '';
  // simple confidence bump for familiar commerce TLDs
  return ['com','ca','co','io','ai','store','shop'].includes(tld) ? 0.65 : 0.35;
}

function detectPlatformFromHost(host: string): string {
  // cheap heuristic only; we avoid network calls here to keep it safe:
  // you can extend with real fetch sniffers later.
  if (host.includes('shopify') || host.endsWith('myshopify.com')) return 'shopify';
  if (host.includes('woocommerce')) return 'woocommerce';
  return 'unknown';
}

function hotnessFromKeywords(kws: string[]): Temperature {
  const kw = kws.map(k=>k.toLowerCase());
  const HOT = ['rfp','rfq','tender','quote','packaging rfp','labels rfq','carton rfp'];
  return kw.some(k => HOT.includes(k)) ? 'hot' : 'warm';
}

function normalizeHost(u: string): string {
  try{
    if (!/^https?:\/\//i.test(u)) u = 'https://'+u;
    const url = new URL(u);
    return url.hostname.toLowerCase();
  }catch{
    // if it was already a hostname, return as-is
    return (u||'').toLowerCase().replace(/^https?:\/\//,'').split('/')[0];
  }
}

async function readSeeds(): Promise<Candidate[]> {
  // Seeds live where you created them earlier: /etc/secrets/seeds.txt
  // Format is flexible: CSV or TSV with columns like:
  // host, title, keywords, city, region, country
  const guesses = [
    '/etc/secrets/seeds.txt',
    '/etc/secrets/seed.txt',
    '/etc/secrets/seeds.csv',
  ];
  for (const p of guesses){
    try{
      const buf = await fs.readFile(p,'utf8');
      const lines = buf.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const out: Candidate[] = [];
      for (const line of lines){
        const parts = line.split(/[,\t]/).map(s=>s.trim());
        if (!parts.length) continue;
        const host = normalizeHost(parts[0]);
        if (!host) continue;
        const title = parts[1] || undefined;
        const keywords = (parts[2] ? parts[2].split(/\s*;\s*|\s*,\s*|\s+/) : []).filter(Boolean);
        const city = parts[3] || undefined;
        const region = parts[4] || undefined;
        const country = parts[5] || undefined;

        const platform = detectPlatformFromHost(host);
        const why: WhyChip[] = [
          { label:'Domain quality', kind:'meta', score:tldQuality(host), detail:`${host}` },
          { label:'Platform fit', kind:'platform', score: platform==='shopify'?0.75 : platform==='woocommerce'?0.60 : 0.5, detail: platform },
        ];
        if (keywords.length){
          why.push({ label:'Intent keywords', kind:'signal', score: keywords.some(k=>/rf[ pq]/i.test(k))?0.90:0.75, detail: keywords.join(', ') });
        }
        if (city || region || country){
          const geoScore = country && onlyUSCA(country) ? 0.9 : 0.5;
          const geoText = [city,region,country].filter(Boolean).join(', ');
          why.push({ label:'Geo', kind:'geo', score: geoScore, detail: geoText||'unknown' });
        }

        const temp = hotnessFromKeywords(keywords);
        out.push({ host, title, platform, cat:'product', keywords, city, region, country, temperature: temp, why });
      }
      return out;
    }catch(e){
      // try next path
    }
  }
  return [];
}

// ——— Optional LLM helpers (Gemini / Groq / OpenRouter) ———
// These are safe: if no keys are set, they simply return []
async function llmSuggest(input: SupplierInput): Promise<Candidate[]> {
  const { supplierDomain, persona, region, limit=10 } = input;
  const prompt = [
    `Supplier website: ${supplierDomain}`,
    persona ? `Buyer persona: ${persona}` : '',
    region ? `Region focus: ${region}` : '',
    `Task: List up to ${limit} US/Canada companies (host only) likely buying packaging relevant to the supplier.`,
    `Return JSON array with objects: {host,title,keywords,city,region,country}.`,
    `Prioritize near region if given; include RFP/RFQ if visible.`
  ].filter(Boolean).join('\n');

  const kGemini = process.env.GEMINI_API_KEY;
  const kGroq = process.env.GROQ_API_KEY;
  const kOpenRouter = process.env.OPENROUTER_API_KEY;

  try{
    if (kGemini){
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='+encodeURIComponent(kGemini),{
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          contents: [{ role:'user', parts:[{text: prompt}]}],
          generationConfig: { temperature: 0.4 }
        })
      });
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return parseLLMJSON(text);
    }
  }catch{}

  try{
    if (kGroq){
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+kGroq
        },
        body: JSON.stringify({
          model:'llama-3.1-70b-versatile',
          messages:[{role:'user', content: prompt}],
          temperature:0.4
        })
      });
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content || '[]';
      return parseLLMJSON(text);
    }
  }catch{}

  try{
    if (kOpenRouter){
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':'Bearer '+kOpenRouter
        },
        body: JSON.stringify({
          model:'anthropic/claude-3.5-sonnet',
          messages:[{role:'user', content: prompt}],
          temperature:0.4
        })
      });
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content || '[]';
      return parseLLMJSON(text);
    }
  }catch{}

  return [];
}

function parseLLMJSON(text: string): Candidate[] {
  // Try to find a JSON array within free-form text
  let arr: any[] = [];
  try{
    const m = text.match(/\[[\s\S]*\]/);
    const raw = m ? m[0] : text;
    arr = JSON.parse(raw);
  }catch{
    return [];
  }
  const out: Candidate[] = [];
  for (const it of arr){
    const host = normalizeHost(it.host||it.domain||'');
    if (!host) continue;
    const kws = (it.keywords||[]).map((x:string)=>String(x));
    const platform = detectPlatformFromHost(host);
    const why: WhyChip[] = [
      { label:'Domain quality', kind:'meta', score:tldQuality(host), detail: host },
      { label:'Platform fit', kind:'platform', score:platform==='shopify'?0.75:platform==='woocommerce'?0.6:0.5, detail: platform },
    ];
    if (kws.length){
      why.push({ label:'Intent keywords', kind:'signal', score: kws.some((k:string)=>/rf[ pq]/i.test(k))?0.9:0.75, detail: kws.join(', ')});
    }
    const country = it.country ? String(it.country) : undefined;
    const city = it.city ? String(it.city) : undefined;
    const region = it.region ? String(it.region) : undefined;
    if (city || region || country){
      const geoScore = country && onlyUSCA(country) ? 0.9 : 0.5;
      const geoText = [city,region,country].filter(Boolean).join(', ');
      why.push({ label:'Geo', kind:'geo', score: geoScore, detail: geoText||'unknown' });
    }
    const temperature = hotnessFromKeywords(kws);
    out.push({ host, title: String(it.title||''), platform, cat:'product', keywords:kws, city, region, country, temperature, why });
  }
  return out;
}

function scorePackagingFit(c: Candidate): number {
  // Roll-up of why[] into a single confidence, weight geo & intent higher.
  let wMeta=0, wPlat=0, wSignal=0, wGeo=0;
  for (const w of c.why){
    if (w.kind==='meta')   wMeta += w.score;
    if (w.kind==='platform') wPlat += w.score;
    if (w.kind==='signal') wSignal += w.score;
    if (w.kind==='geo')    wGeo += w.score;
  }
  // weighted average
  const score = (0.2*wMeta + 0.2*wPlat + 0.4*wSignal + 0.2*wGeo) / (0.2+0.2+0.4+0.2);
  return clamp(score);
}

export async function runWebScout(input: SupplierInput): Promise<Candidate[]> {
  const {
    supplierDomain,
    persona,
    region,
    includeUSA=true,
    includeCanada=true,
    limit=10
  } = input;

  // 1) Seeds (fast)
  const seeds = await readSeeds();

  // 2) LLM suggestions (optional; zero if keys missing)
  const hints = await llmSuggest({ supplierDomain, persona, region, includeUSA, includeCanada, limit });

  // 3) Merge, unique by host, keep US/CA unless both flags false
  const merged = new Map<string, Candidate>();
  const push = (c: Candidate) => {
    if (!includeUSA && !includeCanada){
      // no geo filter
      merged.set(c.host, c);
    }else{
      if (!c.country || (c.country && onlyUSCA(c.country))) merged.set(c.host, c);
    }
  };
  for (const c of seeds) push(c);
  for (const c of hints) push(c);

  // 4) Recompute packaging-fit score and sort
  const list = Array.from(merged.values());
  list.forEach(c=>{
    const fit = scorePackagingFit(c);
    c.why.push({ label:'Packaging fit', kind:'packaging', score: fit, detail: 'roll-up of meta/platform/intent/geo' });
  });

  // Sort: temperature (hot first) then fit desc
  list.sort((a,b)=>{
    if (a.temperature!==b.temperature) return a.temperature==='hot' ? -1 : 1;
    const af = a.why.find(w=>w.label==='Packaging fit')?.score ?? 0;
    const bf = b.why.find(w=>w.label==='Packaging fit')?.score ?? 0;
    return bf - af;
  });

  return list.slice(0, limit);
}
