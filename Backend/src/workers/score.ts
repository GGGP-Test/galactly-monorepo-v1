import { getLLM, ClassifyResult, ExtractResult, Signal, Temperature, parseJSON } from "../ai/llm";

export type { ClassifyResult, ExtractResult, Signal, Temperature };

// Optional patch type (some routes import this)
export interface ScorePatch {
  temperature?: Temperature;
  why?: Signal[];
}

const SYSTEM = `You are a lead-scoring assistant for packaging suppliers.
Given a JSON lead with fields {platform, cat, host, title, kw?}, return JSON:
{"temperature":"hot|warm|cold","why":[{"label":"...","kind":"meta|platform|signal","score":0.0-1.0,"detail":"..."}]}
Only output strict JSON without extra text.`;

export async function scoreLeadLLM(lead: {
  platform?: string;
  cat?: string;
  host?: string;
  title?: string;
  kw?: string[];
}): Promise<ClassifyResult> {
  const llm = getLLM();
  const prompt = `Lead:\n${JSON.stringify(lead)}\nReturn JSON exactly as instructed.`;
  const out = await llm.chat(prompt, { system: SYSTEM, maxTokens: 256, temperature: 0.2 });
  const parsed = parseJSON<ClassifyResult>(out?.trim());
  if (parsed?.temperature && parsed?.why) return parsed;

  // Conservative fallback if the model returns non-JSON text
  return {
    temperature: "warm",
    why: [{ label: "Heuristic fallback", kind: "signal", score: 0.5, detail: "LLM returned unparseable JSON" }]
  };
}
