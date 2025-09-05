import type { ModelAdapter } from './index';
import type { LLMCall, LLMResponse, EmbedRequest, EmbedResponse } from '../llm-router';
import { geminiProvider } from '../llm-providers';

export const GeminiModelAdapter: ModelAdapter = {
  id: 'gemini',
  async complete(req: LLMCall): Promise<LLMResponse> {
    return geminiProvider().complete(req);
  },
  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    return geminiProvider().embed!(req);
  },
};

export default GeminiModelAdapter;
