// src/ai/llm-providers.ts
/**
 * Unified provider layer for major LLM APIs:
 *  - OpenAI (GPT-4.x, GPT-4o, GPT-3.5, o-series)
 *  - Anthropic Claude
 *  - xAI Grok (OpenAI-compatible schema as of 2024/2025)
 *  - OpenRouter (proxy to many models, incl. Llama, Mixtral, Grok, etc.)
 *
 * Goals:
 *  - One normalized request/response type
 *  - Non-stream + stream support (async generator of string deltas)
 *  - Retry with exponential backoff on transient errors
 *  - Cost estimation (tokens * price) with overridable price tables
 *  - Pluggable; consumers can add providers without touching call sites
 */

export type Role = "system" | "user" | "assistant" | "tool";
export interface ChatMessage {
  role: Role;
  content: string;
  name?: string; // optional sender identifier
}

export interface ToolCall {
  id?: string;
  type?: "function";
  function?: { name: string; arguments: string };
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[] | string;
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters: Record<string, any> };
  }>;
  tool_choice?: "none" | "auto" | { type: "function"; function: { name: string } };
  /**
   * If true, providers should stream and `stream()` will be used instead of `call()`.
   * Ignore in `call()`; used by orchestrator to choose path.
   */
  stream?: boolean;
  // per-tenant request metadata (not sent to API)
  meta?: {
    tenantId?: string;
    requestId?: string;
    purpose?: string; // "classify" | "extract" | "draft" | ...
  };
}

export interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // provider-specific raw usage object (pass-through)
  raw?: any;
}

export interface LLMResponse {
  provider: string;
  model: string;
  created: number;
  content: string;                 // aggregated text
  finish_reason?: string;
  tool_calls?: ToolCall[];
  usage?: LLMUsage;
  cost_usd?: number;               // estimated
  requestId?: string;              // echo meta.requestId
  raw?: any;                       // raw provider response (optional)
}

export interface StreamChunk {
  contentDelta?: string;
  finish_reason?: string;
  tool_calls_delta?: ToolCall[];
  usage?: Partial<LLMUsage>; // some providers include rolling token counts late
}

export interface ProviderOptions {
  timeoutMs?: number;          // request timeout
  maxRetries?: number;         // transient error retries
  baseURL?: string;            // override API base
  priceOverrides?: PriceOverrides;
}

export type PriceOverrides = Record<string, {
  prompt: number;      // USD per 1k prompt tokens
  completion: number;  // USD per 1k completion tokens
}>;

export interface LLMProvider {
  readonly name: string;
  call(req: LLMRequest, opts?: ProviderOptions): Promise<LLMResponse>;
  stream(req: LLMRequest, opts?: ProviderOptions): AsyncGenerator<StreamChunk, LLMResponse, void>;
  estimateCost(usage?: LLMUsage, model?: string): number | undefined;
}

/* =============================================
 * Utilities
 * ===========================================*/

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_RETRIES = 2;

function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function shouldRetry(status: number, body: any): boolean {
  if (status >= 500) return true;
  if (status === 429) return true;
  const code = body?.error?.code || body?.error?.type;
  return ["rate_limit_exceeded", "overloaded_error", "temporary_unavailable"].includes(String(code));
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES,
  baseDelay = 500
): Promise<T> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? 0;
      const body = err?.body;
      if (attempt === retries || !shouldRetry(status, body)) break;
      const jitter = Math.random() * 150;
      await delay(baseDelay * Math.pow(2, attempt) + jitter);
      attempt++;
    }
  }
  throw lastErr;
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v ?? fallback;
}

/** Very light SSE line parser (data: ...\n\n) -> yields JSON chunks (if parsable) or text deltas */
async function* parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<any> {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      // skip comments/blank lines
      const lines = raw.split("\n").filter(Boolean);
      for (const ln of lines) {
        const m = ln.match(/^data:\s*(.*)$/);
        if (!m) continue;
        const data = m[1];
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // non-JSON delta
          yield data;
        }
      }
    }
  }
}

/** Sum cost given usage + price table (USD per 1K tokens). */
function costFromUsage(usage: LLMUsage | undefined, price: { prompt: number; completion: number } | undefined) {
  if (!usage || !price) return undefined;
  const p = usage.prompt_tokens ?? 0;
  const c = usage.completion_tokens ?? ((usage.total_tokens ?? 0) - p);
  return (p / 1000) * price.prompt + (c / 1000) * price.completion;
}

/** Basic model price catalog (approx; override via env JSON LLM_PRICE_OVERRIDES) */
const PRICE_TABLE: PriceOverrides = {
  // OpenAI
  "gpt-4o": { prompt: 5.0 / 1, completion: 15.0 / 1 },         // $5/$15 per 1M tokens (convert to per 1k for simplicity)
  "gpt-4o-mini": { prompt: 0.5, completion: 1.5 },
  "gpt-4.1": { prompt: 5.0, completion: 15.0 },
  "gpt-3.5-turbo": { prompt: 0.5, completion: 1.5 },

  // Anthropic (approx)
  "claude-3-5-sonnet": { prompt: 3.0, completion: 15.0 },
  "claude-3-opus": { prompt: 15.0, completion: 75.0 },
  "claude-3-haiku": { prompt: 0.25, completion: 1.25 },

  // xAI Grok (approx)
  "grok-2": { prompt: 2.0, completion: 10.0 },

  // OpenRouter generics (varies by route)
  "openrouter/llama-3.1-70b": { prompt: 1.2, completion: 1.2 },
  "openrouter/mixtral-8x7b": { prompt: 0.9, completion: 0.9 },
};

// Allow env override with JSON
function mergePriceOverrides(base: PriceOverrides, overrides?: PriceOverrides) {
  return { ...base, ...(overrides || {}) };
}

function parseOverrides(): PriceOverrides | undefined {
  try {
    const raw = env("LLM_PRICE_OVERRIDES");
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/* =============================================
 * OpenAI Provider
 * ===========================================*/

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private baseURL: string;
  private prices: PriceOverrides;

  constructor(private apiKey = env("OPENAI_API_KEY"), opts?: ProviderOptions) {
    if (!this.apiKey) console.warn("[OpenAIProvider] Missing OPENAI_API_KEY.");
    this.baseURL = opts?.baseURL || env("OPENAI_BASE_URL") || "https://api.openai.com/v1";
    this.prices = mergePriceOverrides(PRICE_TABLE, opts?.priceOverrides || parseOverrides());
  }

  estimateCost(usage?: LLMUsage, model?: string): number | undefined {
    const price = this.prices[model || ""];
    return costFromUsage(usage, price);
  }

  async call(req: LLMRequest, opts?: ProviderOptions): Promise<LLMResponse> {
    const url = `${this.baseURL}/chat/completions`;
    const payload: any = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      presence_penalty: req.presence_penalty,
      frequency_penalty: req.frequency_penalty,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: false,
    };

    const doFetch = async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(`OpenAI error ${res.status}`);
        err.status = res.status; err.body = body;
        throw err;
      }
      return body;
    };

    const json = await withBackoff(doFetch, opts?.maxRetries ?? DEFAULT_RETRIES);
    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? "";
    const usage: LLMUsage = {
      prompt_tokens: json.usage?.prompt_tokens,
      completion_tokens: json.usage?.completion_tokens,
      total_tokens: json.usage?.total_tokens,
      raw: json.usage,
    };
    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content,
      finish_reason: choice?.finish_reason,
      tool_calls: choice?.message?.tool_calls,
      usage,
      cost_usd: this.estimateCost(usage, req.model),
      requestId: req.meta?.requestId,
      raw: json,
    };
  }

  async *stream(req: LLMRequest, opts?: ProviderOptions): AsyncGenerator<StreamChunk, LLMResponse, void> {
    const url = `${this.baseURL}/chat/completions`;
    const payload: any = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      presence_penalty: req.presence_penalty,
      frequency_penalty: req.frequency_penalty,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const err: any = new Error(`OpenAI stream error ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }

    let aggregated = "";
    let finish: string | undefined;

    for await (const evt of parseSSE(res.body.getReader())) {
      if (typeof evt === "string") {
        // some proxies send plain deltas
        aggregated += evt;
        yield { contentDelta: evt };
        continue;
      }
      const delta = evt?.choices?.[0]?.delta;
      if (delta?.content) {
        aggregated += delta.content;
        yield { contentDelta: delta.content };
      }
      if (delta?.tool_calls) {
        yield { tool_calls_delta: delta.tool_calls };
      }
      const reason = evt?.choices?.[0]?.finish_reason;
      if (reason) finish = reason;
    }

    const resp: LLMResponse = {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content: aggregated,
      finish_reason: finish,
      usage: undefined, // OpenAI sends final usage at end on non-stream; not guaranteed on stream via SSE
      cost_usd: undefined,
      requestId: req.meta?.requestId,
    };
    return resp;
  }
}

/* =============================================
 * Anthropic (Claude) Provider
 * ===========================================*/

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private baseURL: string;
  private prices: PriceOverrides;

  constructor(private apiKey = env("ANTHROPIC_API_KEY"), opts?: ProviderOptions) {
    if (!this.apiKey) console.warn("[AnthropicProvider] Missing ANTHROPIC_API_KEY.");
    this.baseURL = opts?.baseURL || env("ANTHROPIC_BASE_URL") || "https://api.anthropic.com/v1";
    this.prices = mergePriceOverrides(PRICE_TABLE, opts?.priceOverrides || parseOverrides());
  }

  estimateCost(usage?: LLMUsage, model?: string): number | undefined {
    const price = this.prices[model || ""];
    return costFromUsage(usage, price);
  }

  /** Convert OpenAI-like messages to Anthropic "messages" format. */
  private toAnthropicMessages(msgs: ChatMessage[]) {
    const sys: string[] = [];
    const userTurns: any[] = [];
    for (const m of msgs) {
      if (m.role === "system") sys.push(m.content);
      else if (m.role === "user") userTurns.push({ role: "user", content: m.content });
      else if (m.role === "assistant") userTurns.push({ role: "assistant", content: m.content });
    }
    const system = sys.length ? sys.join("\n") : undefined;
    return { system, messages: userTurns };
  }

  async call(req: LLMRequest, opts?: ProviderOptions): Promise<LLMResponse> {
    const url = `${this.baseURL}/messages`;
    const { system, messages } = this.toAnthropicMessages(req.messages);
    const payload: any = {
      model: req.model,
      system,
      messages,
      max_tokens: req.max_tokens ?? 1024,
      temperature: req.temperature,
      top_p: req.top_p,
      // tool support: Anthropic uses "tools" with different schema; skip here for brevity
    };

    const doFetch = async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey!,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(`Anthropic error ${res.status}`);
        err.status = res.status; err.body = body;
        throw err;
      }
      return body;
    };

    const json = await withBackoff(doFetch, opts?.maxRetries ?? DEFAULT_RETRIES);
    const contentBlocks: Array<{ type: string; text?: string }> = json.content || [];
    const content = contentBlocks.map((b) => b.text || "").join("");
    const usage: LLMUsage = {
      prompt_tokens: json.usage?.input_tokens,
      completion_tokens: json.usage?.output_tokens,
      total_tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      raw: json.usage,
    };
    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content,
      finish_reason: json.stop_reason,
      usage,
      cost_usd: this.estimateCost(usage, req.model),
      requestId: req.meta?.requestId,
      raw: json,
    };
  }

  async *stream(req: LLMRequest, opts?: ProviderOptions): AsyncGenerator<StreamChunk, LLMResponse, void> {
    const url = `${this.baseURL}/messages`;
    const { system, messages } = this.toAnthropicMessages(req.messages);
    const payload: any = {
      model: req.model,
      system,
      messages,
      max_tokens: req.max_tokens ?? 1024,
      temperature: req.temperature,
      top_p: req.top_p,
      stream: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const err: any = new Error(`Anthropic stream error ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }

    let aggregated = "";
    let finish: string | undefined;

    for await (const evt of parseSSE(res.body.getReader())) {
      // Anthropic streams events with 'type' fields; delta text often under "delta"
      const deltaText = evt?.delta?.text;
      if (deltaText) {
        aggregated += deltaText;
        yield { contentDelta: deltaText };
      }
      if (evt?.type === "message_stop") {
        finish = "stop";
      }
    }

    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content: aggregated,
      finish_reason: finish,
      requestId: req.meta?.requestId,
    };
  }
}

/* =============================================
 * xAI Grok Provider (OpenAI-compatible)
 * ===========================================*/

export class GrokProvider implements LLMProvider {
  readonly name = "grok";
  private baseURL: string;
  private prices: PriceOverrides;
  constructor(private apiKey = env("XAI_API_KEY") || env("GROK_API_KEY"), opts?: ProviderOptions) {
    if (!this.apiKey) console.warn("[GrokProvider] Missing XAI_API_KEY/GROK_API_KEY.");
    this.baseURL = opts?.baseURL || env("XAI_BASE_URL") || "https://api.x.ai/v1";
    this.prices = mergePriceOverrides(PRICE_TABLE, opts?.priceOverrides || parseOverrides());
  }
  estimateCost(usage?: LLMUsage, model?: string): number | undefined {
    const price = this.prices[model || ""];
    return costFromUsage(usage, price);
  }
  private completionsURL() { return `${this.baseURL}/chat/completions`; }

  async call(req: LLMRequest, opts?: ProviderOptions): Promise<LLMResponse> {
    const payload = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: false,
    };

    const doFetch = async () => {
      const res = await fetch(this.completionsURL(), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(`Grok error ${res.status}`);
        err.status = res.status; err.body = body;
        throw err;
      }
      return body;
    };

    const json = await withBackoff(doFetch, opts?.maxRetries ?? DEFAULT_RETRIES);
    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? "";
    const usage: LLMUsage = {
      prompt_tokens: json.usage?.prompt_tokens,
      completion_tokens: json.usage?.completion_tokens,
      total_tokens: json.usage?.total_tokens,
      raw: json.usage,
    };
    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content,
      finish_reason: choice?.finish_reason,
      usage,
      cost_usd: this.estimateCost(usage, req.model),
      requestId: req.meta?.requestId,
      raw: json,
    };
  }

  async *stream(req: LLMRequest, opts?: ProviderOptions): AsyncGenerator<StreamChunk, LLMResponse, void> {
    const payload = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: true,
    };

    const res = await fetch(this.completionsURL(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const err: any = new Error(`Grok stream error ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }

    let aggregated = "";
    let finish: string | undefined;
    for await (const evt of parseSSE(res.body.getReader())) {
      const delta = evt?.choices?.[0]?.delta;
      if (delta?.content) {
        aggregated += delta.content;
        yield { contentDelta: delta.content };
      }
      const reason = evt?.choices?.[0]?.finish_reason;
      if (reason) finish = reason;
    }

    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content: aggregated,
      finish_reason: finish,
      requestId: req.meta?.requestId,
    };
  }
}

/* =============================================
 * OpenRouter Provider
 * ===========================================*/

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  private baseURL: string;
  private prices: PriceOverrides;

  constructor(private apiKey = env("OPENROUTER_API_KEY"), opts?: ProviderOptions) {
    if (!this.apiKey) console.warn("[OpenRouterProvider] Missing OPENROUTER_API_KEY.");
    this.baseURL = opts?.baseURL || env("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1";
    this.prices = mergePriceOverrides(PRICE_TABLE, opts?.priceOverrides || parseOverrides());
  }

  estimateCost(usage?: LLMUsage, model?: string): number | undefined {
    const price = this.prices[model || ""];
    return costFromUsage(usage, price);
  }

  async call(req: LLMRequest, opts?: ProviderOptions): Promise<LLMResponse> {
    const url = `${this.baseURL}/chat/completions`;
    const payload: any = {
      model: req.model, // e.g. "meta-llama/llama-3.1-70b-instruct"
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: false,
    };

    const doFetch = async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(`OpenRouter error ${res.status}`);
        err.status = res.status; err.body = body;
        throw err;
      }
      return body;
    };

    const json = await withBackoff(doFetch, opts?.maxRetries ?? DEFAULT_RETRIES);
    const choice = json.choices?.[0];
    const content = choice?.message?.content ?? "";
    const usage: LLMUsage = {
      prompt_tokens: json.usage?.prompt_tokens,
      completion_tokens: json.usage?.completion_tokens,
      total_tokens: json.usage?.total_tokens,
      raw: json.usage,
    };
    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content,
      finish_reason: choice?.finish_reason,
      tool_calls: choice?.message?.tool_calls,
      usage,
      cost_usd: this.estimateCost(usage, req.model),
      requestId: req.meta?.requestId,
      raw: json,
    };
  }

  async *stream(req: LLMRequest, opts?: ProviderOptions): AsyncGenerator<StreamChunk, LLMResponse, void> {
    const url = `${this.baseURL}/chat/completions`;
    const payload: any = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.max_tokens,
      temperature: req.temperature,
      top_p: req.top_p,
      stop: req.stop,
      tools: req.tools,
      tool_choice: req.tool_choice,
      stream: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      const err: any = new Error(`OpenRouter stream error ${res.status}`);
      err.status = res.status; err.body = body;
      throw err;
    }

    let aggregated = "";
    let finish: string | undefined;

    for await (const evt of parseSSE(res.body.getReader())) {
      const delta = evt?.choices?.[0]?.delta;
      if (delta?.content) {
        aggregated += delta.content;
        yield { contentDelta: delta.content };
      }
      const reason = evt?.choices?.[0]?.finish_reason;
      if (reason) finish = reason;
    }

    return {
      provider: this.name,
      model: req.model,
      created: Date.now(),
      content: aggregated,
      finish_reason: finish,
      requestId: req.meta?.requestId,
    };
  }
}

/* =============================================
 * Provider registry & helpers
 * ===========================================*/

export type ProviderInit =
  | { kind: "openai"; apiKey?: string; baseURL?: string }
  | { kind: "anthropic"; apiKey?: string; baseURL?: string }
  | { kind: "grok"; apiKey?: string; baseURL?: string }
  | { kind: "openrouter"; apiKey?: string; baseURL?: string };

export function buildProvider(init: ProviderInit, opts?: ProviderOptions): LLMProvider {
  switch (init.kind) {
    case "openai": return new OpenAIProvider(init.apiKey, { ...opts, baseURL: init.baseURL });
    case "anthropic": return new AnthropicProvider(init.apiKey, { ...opts, baseURL: init.baseURL });
    case "grok": return new GrokProvider(init.apiKey, { ...opts, baseURL: init.baseURL });
    case "openrouter": return new OpenRouterProvider(init.apiKey, { ...opts, baseURL: init.baseURL });
    default: throw new Error(`Unknown provider kind: ${(init as any).kind}`);
  }
}

export interface CallOptions extends ProviderOptions {
  providerHint?: "openai" | "anthropic" | "grok" | "openrouter";
}

/** Convenience: pick provider by hint/env and call. */
export async function callLLM(
  req: LLMRequest,
  options: CallOptions = {}
): Promise<LLMResponse> {
  const hint = options.providerHint || (env("LLM_PROVIDER") as any) || "openrouter";
  const provider = buildProvider({ kind: hint as any }, options);
  return provider.call(req, options);
}

/** Convenience: streaming call. */
export async function* streamLLM(
  req: LLMRequest,
  options: CallOptions = {}
): AsyncGenerator<StreamChunk, LLMResponse, void> {
  const hint = options.providerHint || (env("LLM_PROVIDER") as any) || "openrouter";
  const provider = buildProvider({ kind: hint as any }, options);
  return yield* provider.stream(req, options);
}
