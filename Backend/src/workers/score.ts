import { getLLM, Temperature, Signal, ClassifyResult } from "../ai/llm";

export type ScorePatch = {
  id: number;
  temperature: Temperature;
  why: Signal[];
  packagingMath?: ClassifyResult["packagingMath"];
};

export async function scoreLead(input: {
  id: number;
  host: string;
  title?: string;
  platform?: string | null;
  kw?: string[] | null;
}): Promise<ScorePatch> {
  const llm = getLLM();
  const blob = [
    input.title ?? "",
    input.host ?? "",
    (input.platform ?? "unknown"),
    (input.kw ?? []).join(", ")
  ].join(" | ");

  const classified = await llm.classify(blob);

  return {
    id: input.id,
    temperature: classified.temperature,
    why: classified.why,
    packagingMath: classified.packagingMath
  };
}
