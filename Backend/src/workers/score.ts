// Backend/src/workers/score.ts
// Heuristic scoring + optional LLM enrichment.

import { rankLeadWithLLM, type LeadLite } from '../ai/llm';

export interface WhyItem { label: string; kind: 'meta'|'platform'|'signal'|'ai'; score: number; detail: string; }
export interface ScoreResult {
  temperature: 'hot'|'warm';
  confidence: number; // 0..1
  why: WhyItem[];
}

function baseHeuristics(lead: LeadLite): ScoreResult {
  const why: WhyItem[] = [];

  // domain quality (toy rule)
  const tldOk = /\.(com|net|io|co)$/.test(lead.host || '');
  why.push({ label: 'Domain quality', kind: 'meta', score: tldOk ? 0.65 : 0.4, detail: (lead.host || '') + (tldOk ? ' (good TLD)' : ' (unknown TLD)') });

  // platform fit
  const platform = (lead.platform || '').toLowerCase();
  const platformScore = platform === 'shopify' ? 0.75 : platform === 'woocommerce' ? 0.6 : 0.5;
  if (platform) why.push({ label: 'Platform fit', kind: 'platform', score: platformScore, detail: platform });

  // intent keywords
  const kw = (lead.kw || inferKw(lead.title)).map(k => k.toLowerCase());
  const intent = kw.some(k => /(rfp|rfq|packaging|label|carton|mailer)/.test(k)) ? 0.85 : 0.55;
  why.push({ label: 'Intent keywords', kind: 'signal', score: intent, detail: kw.join(', ') || 'n/a' });

  const avg = avgScore(why);
  const temperature: 'hot'|'warm' = avg >= 0.70 ? 'hot' : 'warm';
  return { temperature, confidence: clamp(avg, 0, 1), why };
}

function inferKw(title?: string): string[] {
  if (!title) return [];
  return title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 6);
}

function avgScore(items: WhyItem[]) {
  if (!items.length) return 0.5;
  return items.reduce((s,i)=>s+i.score,0) / items.length;
}
function clamp(n:number,lo:number,hi:number){return Math.max(lo, Math.min(hi, n));}

export async function scoreLead(lead: LeadLite): Promise<ScoreResult> {
  const base = baseHeuristics(lead);

  // If any LLM key is present, enrich – non-blocking with a short time budget.
  const haveLLM = Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY);
  if (!haveLLM) return base;

  try {
    const ai = await rankLeadWithLLM(lead);
    const aiWhy: WhyItem = {
      label: 'AI judgement',
      kind: 'ai',
      score: clamp(ai.demandScore, 0, 1),
      detail: ai.notes || ai.tags?.join(', ') || ai.provider
    };
    const why = [...base.why, aiWhy];
    const confidence = clamp(avgScore(why), 0, 1);
    const temperature: 'hot'|'warm' = confidence >= 0.70 ? 'hot' : 'warm';
    return { temperature, confidence, why };
  } catch {
    return base;
  }
}

// For convenience if some code imported default:
export default { scoreLead };
