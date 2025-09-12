// src/ai/orchestrator.ts
// Purpose: normalize model outputs so the rest of the code can read text safely
// without TS complaining about 'unknown' (was causing choices/candidates/content errors).

// Loosely typed response to avoid 'unknown' property errors in call sites.
export type LLMResponse = any;

export function firstText(resp: LLMResponse): string {
  try {
    if (!resp) return "";

    // OpenAI chat/completions
    const choice =
      (Array.isArray(resp?.choices) && resp.choices[0]) ||
      (Array.isArray(resp?.output) && resp.output[0]) ||
      null;

    const openAiMsg = choice?.message?.content ?? choice?.text;
    if (openAiMsg) return Array.isArray(openAiMsg) ? openAiMsg.join("") : String(openAiMsg);

    // Anthropic (Claude)
    if (typeof resp?.output_text === "string") return resp.output_text;

    // Google (Gemini)
    const cand = Array.isArray(resp?.candidates) ? resp.candidates[0] : undefined;
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      return parts.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("");
    }

    // General fallbacks
    if (typeof resp?.content === "string") return resp.content;
    if (typeof resp?.text === "string") return resp.text;

    return "";
  } catch {
    return "";
  }
}

export async function generateText(model: any, prompt: string): Promise<string> {
  // Support either chat or simple generate style SDKs.
  const resp =
    (typeof model?.chat === "function" && await model.chat({ messages: [{ role: "user", content: prompt }] })) ||
    (typeof model?.generate === "function" && await model.generate({ prompt })) ||
    (typeof model === "function" && await model(prompt)) ||
    null;

  return firstText(resp);
}
