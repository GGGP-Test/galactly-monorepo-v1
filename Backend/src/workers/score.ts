// Backend/src/workers/score.ts

import { getLLM, ClassifyResult, Temperature, Signal } from "../ai/llm";

export type { ClassifyResult, Temperature, Signal };

export interface LeadLite {
  id: string | number;
  host: string;
  platform?: string;
  cat?: string;
  title?: string;
  created_at?: string;
}

export interface ScorePatch {
  temperature?: Temperature;
  why?: Signal[];
  packagingMath?: ClassifyResult["packagingMath"];
}

/**
 * Produce a ScorePatch for a lead using the configured LLM
 * with a safe heuristic fallback inside the LLM router.
 */
export async function scoreLead(lead: LeadLite): Promise<ScorePatch> {
  const text = [
    `Lead #${lead.id}`,
    lead.title ?? "",
    `host: ${lead.host}`,
    lead.platform ? `platform: ${lead.platform}` : "",
    lead.cat ? `category: ${lead.cat}` : "",
    lead.created_at ? `created_at: ${lead.created_at}` : "",
  ].filter(Boolean).join("\n");

  const llm = getLLM();
  const result = await llm.classify(text);
  return {
    temperature: result.temperature,
    why: result.why,
    packagingMath: result.packagingMath,
  };
}

// Alias to match older imports seen in routes
export const scoreLeadLLM = scoreLead;
