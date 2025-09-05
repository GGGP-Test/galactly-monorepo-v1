import type { ModelAdapter } from './index';
import type { LLMCall, LLMResponse, EmbedRequest, EmbedResponse } from '../llm-router';
import { openaiProvider } from '../llm-providers';

export const OpenAIModelAdapter: ModelAdapter = {
  id: 'openai',
  async complete(req: LLMCall): Promise<LLMResponse> {
    return openaiProvider().complete(req);
  },
  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    return openaiProvider().embed!(req);
  },
};

export default OpenAIModelAdapter;
