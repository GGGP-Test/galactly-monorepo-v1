// src/ai/llm/llm-router.ts
// Plan-aware LLM router with fallbacks across Gemini (free), HF (free), OpenAI (paid).
// Minimal clients with fetch; swap to official SDKs if preferred.

import { Flags, FeatureContext } from "../core/feature-flags";

export type ModelKind = "classify" | "extract" | "rewrite" | "reason" | "embed";

export interface LLMRequest {
  kind: ModelKind;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

export interface LLMResponse { text?: string; json?: any; tokens?: number; model?: string; }

export interface LLMClient {
  name: string;
  call(req: LLMRequest): Promise<LLMResponse>;
  supports(kind: ModelKind): boolean;
  costHint?: "free" | "low" | "high";
}

// ---------------- Gemini (free-tier friendly) ----------------
class GeminiClient implements LLMClient {
  name = "gemini-pro";
  costHint: "free" | "low" | "high" = "free";
  constructor(private key = process.env.GOOGLE_API_KEY) {}
  supports(kind: ModelKind) { return ["classify", "extract", "rewrite", "embed"].includes(kind); }
  async call(req: LLMRequest): PromiseLLMResponse> {
    if (!this.key) throw new Error("Missing GOOGLE_API_KEY");
    const model = req.kind === "embed" ? "text-embedding-004" : "gemini-1.5-pro";
    const url = req.kind === "embed"
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${this.key}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.key}`;

    if (req.kind === "embed") {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text: req.prompt }] } }) });
      const j = await r.json();
      return { json: j, model };
    }

    const body = {
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxTokens ?? 512, responseMimeType: req.json ? "application/json" : undefined },
    };
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return req.json ? { json: safeJson(text), model } : { text, model };
  }
}

// ---------------- HuggingFace Inference (free-tier friendly) ----------------
class HFClient implements LLMClient {
  name = "hf-inference";
  costHint: "free" | "low" | "high" = "free";
  constructor(private token = process.env.HF_API_TOKEN, private model = "mistralai/Mistral-7B-Instruct-v0.3") {}
  supports(kind: ModelKind) { return ["classify", "extract", "rewrite", "embed"].includes(kind); }
  async call(req: LLMRequest): PromiseLLMResponse> {
    if (!this.token) throw new Error("Missing HF_API_TOKEN");
    if (req.kind === "embed") {
      const r = await fetch("https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2", {
        method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: req.prompt })
      });
      return { json: await r.json(), model: "all-MiniLM-L6-v2" };
    }
    const r = await fetch(`https://api-inference.huggingface.co/models/${this.model}`, {
      method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: req.prompt, options: { wait_for_model: true } })
    });
    const j = await r.json();
    const txt = Array.isArray(j) ? j.map((x: any) => x.generated_text).join("\n") : (j.generated_text ?? JSON.stringify(j));
    return req.json ? { json: safeJson(txt), model: this.model } : { text: txt, model: this.model };
  }
}

// ---------------- OpenAI (paid/high) ----------------
class OpenAIClient implements LLMClient {
  name = "openai";
  costHint: "free" | "low" | "high" = "high";
  constructor(private key = process.env.OPENAI_API_KEY, private model = "gpt-4o-mini") {}
  supports(kind: ModelKind) { return true; }
  async call(req: LLMRequest): PromiseLLMResponse> {
    if (!this.key) throw new Error("Missing OPENAI_API_KEY");
    const url = "https://api.openai.com/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: req.prompt }],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 512,
        response_format: req.json ? { type: "json_object" } : undefined,
      })
    });
    const j = await r.json();
    const msg = j.choices?.[0]?.message?.content ?? "";
    return req.json ? { json: safeJson(msg), model: this.model } : { text: msg, model: this.model };
  }
}

// ---------------- Router ----------------
export class LLMRouter {
  private gemini = new GeminiClient();
  private hf = new HFClient();
  private openai = new OpenAIClient();

  async route(ctx: FeatureContext, req: LLMRequest): Promise<LLMResponse> {
    const chain: LLMClient[] = [];

    // Free tier defaults
    if (Flags.geminiFree(ctx)) chain.push(this.gemini);
    if (Flags.hfMini(ctx)) chain.push(this.hf);

    // Paid tier augmentation
    if (Flags.openaiPaid(ctx)) chain.unshift(this.openai); // prefer OpenAI first on paid

    // Fallback across chain
    let lastErr: any;
    for (const c of chain) {
      if (!c.supports(req.kind)) continue;
      try { return await c.call(req); } catch (e) { lastErr = e; continue; }
    }
    throw lastErr ?? new Error("No LLM available");
  }
}

// ---------------- Utils ----------------
function safeJson(txt: string) {
  try { return JSON.parse(txt); } catch { return { text: txt }; }
}

type PromiseLLMResponse = Promise<LLMResponse>;
