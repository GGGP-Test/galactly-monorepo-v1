import { getLLM } from '../ai/llm';

export async function scoreSomething(input: string) {
  const llm = await getLLM();               // await fixes Promise<LLM> issue
  const result = await llm.classify(input); // result has no required packagingMath

  const packagingMath = (result as any)?.meta?.packagingMath ?? null;
  return { result, packagingMath };
}
