// backend/src/ai/lm.ts
// Minimal types + stub so other modules can compile.

export type Temperature = number;

export type Signal = {
  label: string;
  score: number;      // 0–1
  detail?: string;
};

export type ClassifyResult = {
  label: string;
  confidence: number; // 0–1
  evidence?: string[];
};

export type LLM = {
  name: string;
  generate: (prompt: string, temperature?: Temperature) => Promise<{ text: string }>;
};

// Simple stub LLM; swap with real provider later.
export function getLLM(): LLM {
  return {
    name: "stub-llm",
    async generate(_prompt: string, _temperature: Temperature = 0.2) {
      return { text: "" };
    },
  };
}
