export type Signal = "rfp" | "rfq" | "ad-spend" | "new-product" | "hiring";
export type Temperature = number;

export type ClassifyResult = {
  label: string;
  score: number; // 0..1
};

type LLM = {
  classifyText: (
    text: string,
    labels: string[]
  ) => Promise<ClassifyResult>;
};

export async function getLLM(): Promise<LLM> {
  // Minimal stub so runtime compiles; swap with your real LLM later.
  return {
    async classifyText(text: string, labels: string[]) {
      // naive placeholder: pick first label with 0.5 score
      return { label: labels[0] ?? "unknown", score: 0.5 };
    },
  };
}
