/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RequestInit } from "node-fetch"; // Node 20 has global fetch; this is just for types.

export type Temperature = "hot" | "warm" | "cold";
export type SignalKind = "meta" | "platform" | "signal" | "ai" | "extract";

export interface Signal {
  label: string;
  kind: SignalKind;
  score: number;      // 0..1
  detail?: string;
}

export interface ClassifyResult {
  temperature: Temperature;
  why: Signal[];
}

export interface ExtractResult {
  packagingTypes: string[];      // e.g. ["cartons","labels","mailers"]
  estOrdersPerMonth?: number | null;
  estUnitsPerMonth?: number | null;
  spendPerMonth?: number | null;
  platformHint?: string | null;  // e.g. "shopify"|"woocommerce"|...
  confidence?: number;           // 0..1
}

export interface DuplicateResult {
  duplicate: boolean;
  confidence: number; // 0..1
}

export interface LLMClient {
  classifyLead(text: string): Promise<ClassifyResult>;
  extractFields(text: string): Promise<ExtractResult>;
  isDuplicate(aText: string, bText: string): Promise<DuplicateResult>;
}

// --------------------------
// Provider selection
// --------------------------
const PROVIDER = (process.env.AI_PROVIDER || "google").toLowerCase(); // "google" | "groq" | "openrouter"
// Keys (configure any subset you’ll use)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_APIKEY || "";
const GROQ_API_KEY   = process.env.GROQ_API_KEY   || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || "";

// Models (safe defaults)
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || "gemini-1.5-flash"; // JSON mode supported
const GROQ_MODEL   = process.env.GROQ_MODEL   || "llama3-70b-8192";
const OR_MODEL     = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-70b-instruct";

// --------------------------
// Shared prompts
// --------------------------
const SYS_CLASSIFY = `You are a strict lead triage system for packaging industry opportunities.
Return JSON with keys: temperature ("hot"|"warm"|"cold"), why (array of {label,kind,score,detail}).
Scoring rules:
- "hot" when there's clear intent (RFP/RFQ, buying now/recent), or strong fit (platform + keywords).
- "warm" when possible intent or partial fit.
- "cold" if irrelevant or no intent.
Scores 0..1. Be concise in "detail". Respond ONLY JSON.`;

const SYS_EXTRACT = `You extract structured fields from messy text about potential packaging leads.
Return JSON with:
- packagingTypes: string[] (like ["cartons","labels","mailers","tape","void fill"])
- estOrdersPerMonth?: number|null
- estUnitsPerMonth?: number|null
- spendPerMonth?: number|null
- platformHint?: string|null
- confidence: number (0..1)
Respond ONLY JSON.`;

const SYS_DUPLICATE = `You decide if two leads describe the same company/opportunity.
Return JSON { "duplicate": boolean, "confidence": number }. Respond ONLY JSON.`;

// --------------------------
// Utilities
// --------------------------
function sloppyJson<T=any>(s: string): T {
  // best-effort parse: trim fences & whitespace
  const t = (s || "").trim()
    .replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  try { return JSON.parse(t) as T; } catch {
    // try to salvage JSON object substring
    const start = t.indexOf("{"); const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sub = t.slice(start, end+1);
      try { return JSON.parse(sub) as T; } catch { /* fallthrough */ }
    }
    throw new Error("LLM returned non-JSON content");
  }
}

async function httpJSON(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init as any);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${res.status} ${res.statusText} — ${msg}`);
  }
  return body;
}

// --------------------------
// Google (Gemini) client
// --------------------------
class GoogleClient implements LLMClient {
  private endpoint(model: string) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GOOGLE_API_KEY)}`;
  }

  private async call(system: string, user: string, wantJson = true): Promise<any> {
    const body = {
      contents: [{ role: "user", parts: [{ text: `${system}\n\n---\n${user}` }]}],
      generationConfig: wantJson ? { temperature: 0.2, response_mime_type: "application/json" } : { temperature: 0.2 }
    };
    const data = await httpJSON(this.endpoint(GOOGLE_MODEL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (wantJson) return sloppyJson(text);
    return text;
  }

  async classifyLead(text: string): Promise<ClassifyResult> {
    const out = await this.call(SYS_CLASSIFY, text, true);
    return out as ClassifyResult;
  }
  async extractFields(text: string): Promise<ExtractResult> {
    const out = await this.call(SYS_EXTRACT, text, true);
    return out as ExtractResult;
  }
  async isDuplicate(a: string, b: string): Promise<DuplicateResult> {
    const out = await this.call(SYS_DUPLICATE, JSON.stringify({ a, b }), true);
    return out as DuplicateResult;
  }
}

// --------------------------
// Groq (OpenAI compat)
// --------------------------
class GroqClient implements LLMClient {
  private async call(system: string, user: string, wantJson = true): Promise<any> {
    const body = {
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.2,
      ...(wantJson ? { response_format: { type: "json_object" } } : {})
    };
    const data = await httpJSON("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (wantJson) return sloppyJson(text);
    return text;
  }
  classifyLead = async (t: string) => this.call(SYS_CLASSIFY, t, true) as Promise<ClassifyResult>;
  extractFields = async (t: string) => this.call(SYS_EXTRACT, t, true) as Promise<ExtractResult>;
  isDuplicate = async (a: string, b: string) => this.call(SYS_DUPLICATE, JSON.stringify({ a, b }), true) as Promise<DuplicateResult>;
}

// --------------------------
// OpenRouter (OpenAI compat)
// --------------------------
class OpenRouterClient implements LLMClient {
  private async call(system: string, user: string, wantJson = true): Promise<any> {
    const body = {
      model: OR_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.2,
      ...(wantJson ? { response_format: { type: "json_object" } } : {})
    };
    const data = await httpJSON("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://galactly.local", // optional, helps OR analytics
        "X-Title": "Lead Intelligence"
      },
      body: JSON.stringify(body)
    });
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (wantJson) return sloppyJson(text);
    return text;
  }
  classifyLead = async (t: string) => this.call(SYS_CLASSIFY, t, true) as Promise<ClassifyResult>;
  extractFields = async (t: string) => this.call(SYS_EXTRACT, t, true) as Promise<ExtractResult>;
  isDuplicate = async (a: string, b: string) => this.call(SYS_DUPLICATE, JSON.stringify({ a, b }), true) as Promise<DuplicateResult>;
}

// --------------------------
// Factory
// --------------------------
export function getLLM(): LLMClient | null {
  if (PROVIDER === "google" && GOOGLE_API_KEY) return new GoogleClient();
  if (PROVIDER === "groq"   && GROQ_API_KEY)   return new GroqClient();
  if (PROVIDER === "openrouter" && OPENROUTER_API_KEY) return new OpenRouterClient();

  // Soft fallback order if provider not explicitly set but some key exists:
  if (GOOGLE_API_KEY) return new GoogleClient();
  if (GROQ_API_KEY)   return new GroqClient();
  if (OPENROUTER_API_KEY) return new OpenRouterClient();

  return null; // no provider configured
}
