/* eslint-disable @typescript-eslint/no-explicit-any */
import { getLLM, type ClassifyResult, type ExtractResult, type Signal, type Temperature } from "../ai/llm";

export interface LeadLike {
  id: string;
  title: string;
  host?: string;
  platform?: string;
  cat?: string;
  created_at?: string;
}

export interface ScorePatch {
  temperature: Temperature;
  why: Signal[];
  packagingMath?: {
    spendPerMonth: number | null;
    estOrdersPerMonth: number | null;
    estUnitsPerMonth: number | null;
    packagingTypeHint?: string | null;
    confidence?: number;
  }
}

/**
 * Runs LLM-based extraction + classification.
 * Returns a patch you can merge into your lead object/response.
 * If no provider is configured, returns null.
 */
export async function scoreLeadLLM(lead: LeadLike): Promise<ScorePatch | null> {
  const llm = getLLM();
  if (!llm) return null;

  const text = [
    lead.title,
    lead.host ? `Host: ${lead.host}` : "",
    lead.platform ? `Platform: ${lead.platform}` : "",
    lead.cat ? `Category: ${lead.cat}` : ""
  ].filter(Boolean).join("\n");

  const [ext, cls] = await Promise.all([
    llm.extractFields(text).catch(() => null as ExtractResult | null),
    llm.classifyLead(text).catch(() => null as ClassifyResult | null),
  ]);

  const why: Signal[] = [];
  let temperature: Temperature = "warm";

  if (cls) {
    temperature = cls.temperature;
    (cls.why || []).forEach(s => why.push({ ...s, kind: "ai" }));
  }

  if (ext) {
    why.push({
      label: "Extracted packaging",
      kind: "extract",
      score: ext.confidence ?? 0.6,
      detail: (ext.packagingTypes || []).join("/")
    });
  }

  const patch: ScorePatch = {
    temperature,
    why,
    packagingMath: {
      spendPerMonth: ext?.spendPerMonth ?? null,
      estOrdersPerMonth: ext?.estOrdersPerMonth ?? null,
      estUnitsPerMonth: ext?.estUnitsPerMonth ?? null,
      packagingTypeHint: ext?.packagingTypes?.[0] ?? null,
      confidence: ext?.confidence ?? undefined
    }
  };

  return patch;
}
