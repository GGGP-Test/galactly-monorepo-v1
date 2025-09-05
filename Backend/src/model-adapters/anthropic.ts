import type { ModelAdapter } from './index';
import type { LLMCall, LLMResponse } from '../llm-router';
import { anthropicProvider } from '../llm-providers';

export const AnthropicModelAdapter: ModelAdapter = {
  id: 'anthropic',
  async complete(req: LLMCall): Promise<LLMResponse> {
    return anthropicProvider().complete(req);
  },
};

export default AnthropicModelAdapter;
