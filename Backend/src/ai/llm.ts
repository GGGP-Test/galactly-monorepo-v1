// Backend/src/ai/llm.ts
// Minimal, dependency-free LLM router with time-budget + fallbacks.
// Node 20+ provides global fetch – no 'node-fetch' needed.

export type Provider = 'gemini' | 'groq' | 'openrouter';

export interface LeadLite {
  id?: string | number;
  host?: string;
  platform?: string;
  cat?: string;
  title?: string;
  kw?: string[];
  created_at?: string;
}

export interface LLMResult {
  provider: Provider;
  model: string;
  notes: string;           // short, human friendly rationale
  demandScore: number;     // 0..1
  tags: string[];          // e.g., ['rfp','packaging','labels']
  raw?: any;
}

const env = {
  geminiKey: process.env.GEMINI_API_KEY || '',
  groqKey: process.env.GROQ_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  defaultProv: (process.env.LLM_DEFAULT as Provider) || 'gemini',
  timeBudgetMs: Number(process.env.LLM_TIME_BUDGET_MS || 2500),
};

function promptFor(lead: LeadLite) {
  const kw = lead.kw?.join(', ') || '—';
  return [
    `You are ranking packaging sales leads.`,
    `Return JSON with fields: demandScore (0..1), tags (array of short tokens), notes (<=160 chars).`,
    `Lead:`,
    `title: ${lead.title || ''}`,
    `host: ${lead.host || ''}`,
    `platform: ${lead.platform || ''}`,
    `category: ${lead.cat || ''}`,
    `keywords: ${kw}`,
  ].join('\n');
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
  let done = false;
  return new Promise((resolve) => {
    const t = setTimeout(async () => {
      if (done) return;
      done = true;
      resolve(await onTimeout());
    }, ms);
    p.then((v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(v);
    }).catch(async () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(await onTimeout());
    });
  });
}

// ---------- Providers ----------

async function callGemini(prompt: string): Promise<LLMResult> {
  if (!env.geminiKey) throw new Error('Missing GEMINI_API_KEY');
  // Default to a widely-available text model; you can change via env later.
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.geminiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`gemini http ${res.status}`);
  const data: any = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = safeParse(text);
  return { provider: 'gemini', model, ...parsed, raw: data };
}

async function callGroq(prompt: string): Promise<LLMResult> {
  if (!env.groqKey) throw new Error('Missing GROQ_API_KEY');
  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model,
    messages: [{ role: 'system', content: 'Return only JSON as instructed.' }, { role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 256,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.groqKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`groq http ${res.status}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = safeParse(text);
  return { provider: 'groq', model, ...parsed, raw: data };
}

async function callOpenRouter(prompt: string): Promise<LLMResult> {
  if (!env.openrouterKey) throw new Error('Missing OPENROUTER_API_KEY');
  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model,
    messages: [{ role: 'system', content: 'Return only JSON as instructed.' }, { role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 256,
  };
  const headers: Record<string,string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${env.openrouterKey}`,
    // (Optional but nice) Helps OpenRouter attribute traffic:
    'HTTP-Referer': 'https://gggp-test.github.io/galactly-monorepo-v1/',
    'X-Title': 'Galactly Leads Intelligence'
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`openrouter http ${res.status}`);
  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = safeParse(text);
  return { provider: 'openrouter', model, ...parsed, raw: data };
}

function safeParse(text: string): Pick<LLMResult,'notes'|'demandScore'|'tags'> {
  // Try to find a JSON object in the text; fall back to a simple guess.
  try {
    const m = text.match(/\{[\s\S]*\}$/);
    const obj = JSON.parse(m ? m[0] : text);
    const demandScore = clamp(Number(obj.demandScore ?? obj.score ?? 0.5), 0, 1);
    const tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
    const notes = String(obj.notes ?? '').slice(0, 200);
    return { demandScore, tags, notes };
  } catch {
    return { demandScore: 0.5, tags: [], notes: text.slice(0, 200) };
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

// ---------- Public API ----------

export async function rankLeadWithLLM(lead: LeadLite): Promise<LLMResult> {
  const prompt = promptFor(lead);

  // Provider order: default → groq → openrouter
  const order: Provider[] = (() => {
    const d = env.defaultProv;
    return d === 'gemini' ? ['gemini','groq','openrouter']
         : d === 'groq' ? ['groq','gemini','openrouter']
         : ['openrouter','gemini','groq'];
  })();

  async function attempt(p: Provider): Promise<LLMResult> {
    if (p === 'gemini') return callGemini(prompt);
    if (p === 'groq') return callGroq(prompt);
    return callOpenRouter(prompt);
  }

  // Ultra-fast fallback: if the first attempt exceeds the time budget,
  // immediately resolve to Groq (very low latency) while the first may continue.
  const first = attempt(order[0]);
  const fast = withTimeout(first, env.timeBudgetMs, async () => {
    // If the primary didn’t finish in time, try Groq quickly:
    if (order[0] !== 'groq') {
      try { return await attempt('groq'); } catch { /* ignore */ }
    }
    // otherwise try the remaining provider(s)
    for (let i = 1; i < order.length; i++) {
      try { return await attempt(order[i]); } catch { /* keep falling back */ }
    }
    // final fallback if everything fails
    return { provider: order[0], model: 'none', demandScore: 0.5, tags: [], notes: 'LLM unavailable' };
  });

  return fast;
}
