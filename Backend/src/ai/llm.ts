export type Signal = "rfp" | "rfq" | "ad-spend" | "new-product" | "hiring";
export type Temperature = number;

export type ClassifyResult = {
  label: string;
  score: number;
};

type LLM = {
  classifyText: (text: string, labels: string[]) => Promise<ClassifyResult>;
};

export async function getLLM(): Promise<LLM> {
  // Placeholder implementation to satisfy runtime.
  return {
    async classifyText(text: string, labels: string[]) {
      return { label: labels[0] ?? "unknown", score: 0.5 };
    }
  };
}
