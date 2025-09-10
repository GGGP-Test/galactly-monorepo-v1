// Minimal LLM router + types used elsewhere. Uses built-in fetch (Node 18+).
export type Temperature = "cold" | "warm" | "hot";

export interface Signal {
  label: string;
  kind: "meta" | "platform" | "signal";
  score: number;         // 0..1
  detail?: string;
}

export interface ExtractResult {
  keywords: string[];
  platform?: string;
  category?: string;
}

export interface ClassifyResult {
  temperature: Temperature;
  why: Signal[];
}

export interface LLM {
  name: string;
  chat(prompt: string, opts?: { system?: string; temperature?: number; maxTokens?: number }): Promise<string>;
}

function pickEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/* ---------------- Providers ---------------- */

class GeminiLLM implements LLM {
  name = "gemini";
  constructor(
    private apiKey: string,
    private model = process.env.GEMINI_MODEL || process.env.GOOGLE_MODEL || "gemini-1.5-flash"
  ) {}
  async chat(prompt: string, opts?: { system?: string; temperature?: number; maxTokens?: number }): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const parts: any[] = [];
    if (opts?.system) parts.push({ text: opts.system });
    parts.push({ text: prompt });
    const body = {
      contents: [{ role: "user", parts: parts.map(p => ({ text: p.text })) }],
      generationConfig: {
        temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.2,
        maxOutputTokens: opts?.maxTokens ?? 512
      }
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    } as any);
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("") ?? "";
    return text;
  }
}

class GroqLLM implements LLM {
  name = "groq";
  constructor(private apiKey: string, private model = process.env.GROQ_MODEL || "llama-3.1-8b-instant") {}
  async chat(prompt: string, opts?: { system?: string; temperature?: number; maxTokens?: number }): Promise<string> {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const body = {
      model: this.model,
      temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.2,
      max_tokens: opts?.maxTokens ?? 512,
      messages: [
        ...(opts?.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt }
      ]
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    } as any);
    if (!res.ok) throw new Error(`groq ${res.status}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}

class OpenRouterLLM implements LLM {
  name = "openrouter";
  constructor(
    private apiKey: string,
    private model = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free"
  ) {}
  async chat(prompt: string, opts?: { system?: string; temperature?: number; maxTokens?: number }): Promise<string> {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const body = {
      model: this.model,
      temperature: typeof opts?.temperature === "number" ? opts.temperature : 0.2,
      max_tokens: opts?.maxTokens ?? 512,
      messages: [
        ...(opts?.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt }
      ]
    };
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://galactly.app",
        "X-Title": "Galactly-Backend"
      },
      body: JSON.stringify(body)
    } as any);
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}

/* -------------- Router + helpers ----------- */

export function getLLM(): LLM {
  const gemKey = pickEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "AI_GOOGLE_KEY");
  const groqKey = pickEnv("GROQ_API_KEY", "AI_GROQ_KEY");
  const orKey = pickEnv("OPENROUTER_API_KEY", "AI_OPENROUTER_KEY");

  // Default preference: Gemini → Groq → OpenRouter
  if (gemKey) return new GeminiLLM(gemKey);
  if (groqKey) return new GroqLLM(groqKey);
  if (orKey) return new OpenRouterLLM(orKey);
  throw new Error("No LLM key configured");
}

export function parseJSON<T = any>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
