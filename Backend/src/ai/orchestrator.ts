// Backend/src/ai/orchestrator.ts
// Unified AI router: Grok primary, others as specialists/fallbacks.

type LeadInput = {
  url: string;
  title?: string;
  snippet?: string;
  source?: 'web'|'linkedin'|'youtube'|'reddit'|'gov'|string;
};

type ReasonResp = {
  model: string;
  hotScore: number;         // 0–100
  heat: 'HOT'|'WARM'|'OK';
  reasons: string[];        // bullets
  tags: string[];           // short tags
  origin: string;           // hostname
};

function env(name: string, d = ''): string { return (process.env[name] || d).trim(); }
const fetchJSON = async (u: string, init: RequestInit) => {
  const r = await fetch(u, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

// ---------------- Grok (xAI) ----------------
// NOTE: Adjust base/model names to your actual Grok API.
// Using OpenAI-style JSON since most vendors mirror it.
const GROK_BASE  = env('GROK_BASE',  'https://api.x.ai/v1');
const GROK_MODEL = env('GROK_MODEL', 'grok-2-latest');
const GROK_KEY   = env('GROK_API_KEY', '');

async function callGrok(system: string, user: string): Promise<string> {
  if (!GROK_KEY) throw new Error('GROK_API_KEY missing');
  const body = {
    model: GROK_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.2
  };
  const data = await fetchJSON(`${GROK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${GROK_KEY}` },
    body: JSON.stringify(body)
  });
  const txt = data?.choices?.[0]?.message?.content || '';
  if (!txt) throw new Error('empty Grok response');
  return txt;
}

// ---------------- Claude (Anthropic) ---------------
const ANTH_KEY = env('ANTHROPIC_API_KEY', '');
async function callClaude(system: string, user: string): Promise<string> {
  if (!ANTH_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  const body = {
    model: env('CLAUDE_MODEL','claude-3-5-sonnet-latest'),
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 800,
    temperature: 0.2
  };
  const data = await fetchJSON('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTH_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const txt = data?.content?.[0]?.text || '';
  if (!txt) throw new Error('empty Claude response');
  return txt;
}

// ---------------- Gemini (Google) -------------------
const GEM_KEY = env('GEMINI_API_KEY','');
async function callGemini(system: string, user: string): Promise<string> {
  if (!GEM_KEY) throw new Error('GEMINI_API_KEY missing');
  const model = env('GEMINI_MODEL','gemini-1.5-pro');
  const data = await fetchJSON(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEM_KEY}`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({
      contents:[{parts:[{text: `${system}\n\n${user}` }]}],
      generationConfig:{ temperature: 0.2 }
    })
  });
  const txt = data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text).join('') || '';
  if (!txt) throw new Error('empty Gemini response');
  return txt;
}

// ---------------- DeepSeek --------------------------
const DS_KEY = env('DEEPSEEK_API_KEY','');
async function callDeepSeek(system: string, user: string): Promise<string> {
  if (!DS_KEY) throw new Error('DEEPSEEK_API_KEY missing');
  const model = env('DEEPSEEK_MODEL','deepseek-chat');
  const data = await fetchJSON('https://api.deepseek.com/v1/chat/completions', {
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${DS_KEY}`},
    body: JSON.stringify({
      model, temperature: 0.2,
      messages:[{role:'system', content: system},{role:'user', content: user}]
    })
  });
  const txt = data?.choices?.[0]?.message?.content || '';
  if (!txt) throw new Error('empty DeepSeek response');
  return txt;
}

// ---------------- OpenAI (optional) -----------------
const OAI_KEY = env('OPENAI_API_KEY','');
async function callOpenAI(system: string, user: string): Promise<string> {
  if (!OAI_KEY) throw new Error('OPENAI_API_KEY missing');
  const model = env('OPENAI_MODEL','gpt-4o-mini');
  const data = await fetchJSON('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${OAI_KEY}`},
    body: JSON.stringify({
      model, temperature: 0.2,
      messages:[{role:'system', content: system},{role:'user', content: user}]
    })
  });
  const txt = data?.choices?.[0]?.message?.content || '';
  if (!txt) throw new Error('empty OpenAI response');
  return txt;
}

// ---------------- Orchestration ---------------------
const SYSTEM_REASONER = `You are a packaging-buyer lead screener.
Input is a {title, snippet, url, source}. Output STRICT JSON with:
- hotScore: 0-100 (likelihood the buyer wants packaging help soon),
- heat: HOT|WARM|OK,
- reasons: 3-6 short bullets focused on concrete signals (industry, intent, due dates, volumes, region),
- tags: 3-8 short tags (e.g., "RFP", "co-packer", "corrugated"),
Return ONLY JSON.`;

function buildUserPrompt(lead: LeadInput): string {
  return `Lead:
title: ${lead.title || ''}
snippet: ${lead.snippet || ''}
url: ${lead.url}
source: ${lead.source || 'web'}

Consider “packaging” as corrugated/cartons/labels/flexible/rigid/foam/crating/co-packer/kitting/3PL.
Penalize generic directory pages. Reward fresh posts, clear ask, quantities, due dates, NA region.`;
}

function parseReasonJSON(txt: string): ReasonResp {
  const m = txt.match(/\{[\s\S]*\}$/);
  const raw = m ? m[0] : txt;
  const j = JSON.parse(raw);
  let heat: 'HOT'|'WARM'|'OK' = 'OK';
  const s = Math.max(0, Math.min(100, Number(j.hotScore)||0));
  if (s >= 75) heat = 'HOT';
  else if (s >= 55) heat = 'WARM';
  const origin = new URL(j.url || j.origin || 'http://example.com').hostname.replace(/^www\./,'');
  return {
    model: String(j.model || ''),
    hotScore: s,
    heat,
    reasons: Array.isArray(j.reasons) ? j.reasons.slice(0,8) : [],
    tags: Array.isArray(j.tags) ? j.tags.slice(0,10) : [],
    origin
  };
}

// Main entry – Grok first, then specialists, then fallbacks
export async function reasonsForLead(lead: LeadInput): Promise<ReasonResp> {
  const user = buildUserPrompt(lead);

  // 1) Grok primary
  try {
    const txt = await callGrok(SYSTEM_REASONER, user);
    const parsed = parseReasonJSON(txt);
    parsed.model = parsed.model || 'grok';
    return parsed;
  } catch {}

  // 2) Specialize by source
  const trySpecialists: Array<() => Promise<string>> = [];
  if ((lead.source||'').toLowerCase() === 'youtube') {
    trySpecialists.push(() => callGemini(SYSTEM_REASONER, user));
  } else {
    trySpecialists.push(() => callClaude(SYSTEM_REASONER, user));
  }

  for (const fn of trySpecialists) {
    try { return { ...parseReasonJSON(await fn()), model: parsedModelName(fn) }; } catch {}
  }

  // 3) Cheap fallback
  try { return { ...parseReasonJSON(await callDeepSeek(SYSTEM_REASONER, user)), model: 'deepseek' }; } catch {}
  try { return { ...parseReasonJSON(await callOpenAI(SYSTEM_REASONER, user)), model: 'openai' }; } catch {}

  // 4) Last resort heuristic
  const origin = new URL(lead.url).hostname.replace(/^www\./,'');
  return {
    model: 'heuristic',
    hotScore: 50,
    heat: 'OK',
    reasons: ['Heuristic fallback: packaging keywords present.'],
    tags: ['fallback','needs-check'],
    origin
  };
}

function parsedModelName(fn: Function): string {
  if (fn === callClaude as any) return 'claude';
  if (fn === callGemini as any) return 'gemini';
  return 'unknown';
}
