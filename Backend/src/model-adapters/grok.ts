import type { ModelAdapter } from './index';
import type { LLMCall, LLMResponse } from '../llm-router';
import { grokProvider } from '../llm-providers';

export const GrokModelAdapter: ModelAdapter = {
  id: 'grok',
  async complete(req: LLMCall): Promise<LLMResponse> {
    return grokProvider().complete(req);
  },
};

export default GrokModelAdapter;
