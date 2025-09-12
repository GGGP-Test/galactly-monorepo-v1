export type ClassifyResult = {
  label: string;
  score: number;
  meta?: Record<string, unknown>;
};

export interface LLM {
  classify(input: string): Promise<ClassifyResult>;
}

export async function getLLM(): Promise<LLM> {
  // stub; replace with real provider later
  return {
    async classify(input: string): Promise<ClassifyResult> {
      return { label: 'none', score: 0, meta: { input } };
    }
  };
}
