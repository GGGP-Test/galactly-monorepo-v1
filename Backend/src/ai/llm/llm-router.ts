// src/ai/runtime/llm-router.ts
/**
 * LLM Router — routes tasks to OpenAI, Anthropic (Claude), Grok (via OpenRouter), or OpenRouter models.
 * Free plan can be wired to Gemini Flash if you set GOOGLE_API_KEY (optional).
 *
 * Env:
 *  - OPENAI_API_KEY
 *  - ANTHROPIC_API_KEY
 *  - OPENROUTER_API_KEY  (used for OpenRouter + Grok via openrouter)
 *  - GOOGLE_API_KEY      (optional, for Gemini Flash on free)
 *  - OPENROUTER_API_URL  (default: https://openrouter.ai/api/v1/chat/completions)
 */
export type Plan = "free" | "pro" | "scale";
export type Task =
  | "classify"      // light taxonomy, scoring, labels
  | "extract"       // structured JSON from text
  | "summarize"     // concise summaries
  | "reason"        // multi-hop reasoning
  | "outreach_copy" // short persuasive drafts
  | "rerank";       // ranking short items by relevance

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatResult = { text: string; model: string; provider: string; usage?: any };

export interface LLMRouterOptions {
  plan: Plan;
  region?: "us" | "eu" | "global";
}

const OPENROUTER_URL = process.env.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions";

export class LLMRouter {
  constructor(private readonly opts: LLMRouterOptions) {}

  /** High-level chat entrypoint */
  async chat(task: Task, messages: ChatMessage[], json?: boolean): Promise<ChatResult> {
    const choice = chooseModel(task, this.opts);
    switch (choice.provider) {
      case "openai":
        return callOpenAI(choice.model, messages, json);
      case "anthropic":
        return callAnthropic(choice.model, messages, json);
      case "openrouter":
        return callOpenRouter(choice.model, messages, json);
      case "gemini":
        return callGemini(choice.model, messages, json);
      default:
        throw new Error(`Unknown provider: ${choice.provider}`);
    }
  }
}

/** Decide model per task & plan. You can tweak this matrix anytime. */
function chooseModel(task: Task, { plan }: LLMRouterOptions): { provider: "openai" | "anthropic" | "openrouter" | "gemini"; model: string } {
  // Default matrix
  const M: Record<Plan, Record<Task, { provider: any; model: string }>> = {
    free: {
      classify: { provider: "gemini", model: "gemini-1.5-flash" },
      extract: { provider: "gemini", model: "gemini-1.5-flash" },
      summarize:{ provider: "gemini", model: "gemini-1.5-flash" },
      reason:   { provider: "openrouter", model: "google/gemma-2-9b-it:free" },
      outreach_copy: { provider: "openrouter", model: "google/gemma-2-9b-it:free" },
      rerank:   { provider: "openrouter", model: "cohere/command-r-plus-08-2024" }, // via OpenRouter
    },
    pro: {
      classify: { provider: "openai", model: "gpt-4o-mini" },
      extract:  { provider: "anthropic", model: "claude-3-5-sonnet" },
      summarize:{ provider: "openai", model: "gpt-4o-mini" },
      reason:   { provider: "anthropic", model: "claude-3-5-sonnet" },
      outreach_copy: { provider: "openai", model: "gpt-4o-mini" },
      rerank:   { provider: "openrouter", model: "cohere/rerank-3" },
    },
    scale: {
      classify: { provider: "openai", model: "gpt-4o" },
      extract:  { provider: "anthropic", model: "claude-3-5-sonnet" },
      summarize:{ provider: "openai", model: "gpt-4o" },
      reason:   { provider: "anthropic", model: "claude-3-5-sonnet" },
      outreach_copy: { provider: "openrouter", model: "xai/grok-2" }, // Grok via OpenRouter
      rerank:   { provider: "openrouter", model: "cohere/rerank-3" },
    },
  };
  // If GOOGLE_API_KEY missing, free falls back to OpenRouter free model
  if (plan === "free" && !process.env.GOOGLE_API_KEY) {
    return { provider: "openrouter", model: "google/gemma-2-9b-it:free" };
  }
  return M[plan][task];
}

// -------------------- Providers --------------------

async function callOpenAI(model: string, messages: ChatMessage[], json?: boolean): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.2,
    }),
  });
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, model, provider: "openai", usage: data?.usage };
}

async function callAnthropic(model: string, messages: ChatMessage[], json?: boolean): Promise<ChatResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const sys = messages.find(m => m.role === "system")?.content;
  const userMsgs = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: sys,
      messages: userMsgs,
      temperature: 0.2,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      max_tokens: 1000,
    }),
  });
  const data = await r.json();
  const text = data?.content?.[0]?.text || "";
  return { text, model, provider: "anthropic", usage: data?.usage };
}

/** OpenRouter also serves Grok (xai/*), Cohere, etc. */
async function callOpenRouter(model: string, messages: ChatMessage[], json?: boolean): Promise<ChatResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY missing");
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE || "https://yourapp.example",
      "X-Title": process.env.OPENROUTER_APP || "Lead AI",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return { text, model, provider: model.startsWith("xai/") ? "grok" : "openrouter", usage: data?.usage };
}

/** Optional: Gemini Flash for free plan */

async function callGemini(model: string, messages: ChatMessage[], json?: boolean): Promise<ChatResult> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY missing");
  // Collapse to a single prompt; treat system as prefix
  const sys = messages.find(m => m.role === "system")?.content || "";
  const user = messages.filter(m => m.role !== "system").map(m => m.content).join("\n\n");
  const prompt = sys ? `${sys}\n\n${user}` : user;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0.2 },
      ...(json ? { response_mime_type: "application/json" } : {}),
    }),
  });
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
  return { text, model, provider: "gemini", usage: data?.usageMetadata };
}
