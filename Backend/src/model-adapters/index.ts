/*
  Model adapters — thin layer that normalizes provider-specific shapes to a common interface.
  These wrap the low-level clients in `llm-providers.ts` to decouple call sites.
*/

import type { LLMCall, LLMResponse, EmbedRequest, EmbedResponse } from '../llm-router';
import { openaiProvider, anthropicProvider, grokProvider, geminiProvider } from '../llm-providers';

export interface ModelAdapter {
  id: string;
  complete(req: LLMCall): Promise<LLMResponse>;
  embed?(req: EmbedRequest): Promise<EmbedResponse>;
}

export const OpenAIAdapter: ModelAdapter = {
  id: 'openai',
  async complete(req) {
    return openaiProvider().complete(req);
  },
  async embed(req) {
    return openaiProvider().embed!(req);
  },
};

export const AnthropicAdapter: ModelAdapter = {
  id: 'anthropic',
  async complete(req) {
    return anthropicProvider().complete(req);
  },
};

export const GrokAdapter: ModelAdapter = {
  id: 'grok',
  async complete(req) {
    return grokProvider().complete(req);
  },
};

export const GeminiAdapter: ModelAdapter = {
  id: 'gemini',
  async complete(req) {
    return geminiProvider().complete(req);
  },
  async embed(req) {
    return geminiProvider().embed!(req);
  },
};

export const Adapters = {
  openai: OpenAIAdapter,
  anthropic: AnthropicAdapter,
  grok: GrokAdapter,
  gemini: GeminiAdapter,
};
