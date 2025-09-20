// src/services/find-buyers.ts
import { runProviders, type FindBuyersInput, type Candidate } from "../providers";
import { makeKey, cacheGet, cacheSet } from "../utils/fsCache";

/**
 * Normalize raw input into a strict FindBuyersInput that matches our provider contracts.
 * - Ensures strings (no string[]) for persona.titles
 * - Fills safe defaults for missing fields
 */
function normalizeInput(raw: Partial<FindBuyersInput>): FindBuyersInput {
  const supplier = String(raw.supplier ?? "").trim().toLowerCase();
  const region = String(raw.region ?? "usca").trim().toLowerCase();
  const radiusMi = Number(raw.radiusMi ?? 50) || 50;

  const p = raw.persona ?? { offer: "", solves: "", titles: "" };
  // titles can arrive as string or string[] — collapse to a single string
  const titles =
    Array.isArray((p as any).titles) ? (p as any).titles.join(", ") : String(p.titles ?? "");

  return {
    supplier,
    region,
    radiusMi,
    persona: {
      offer: String(p.offer ?? ""),
      solves: String(p.solves ?? ""),
      titles,
    },
  };
}

function countByTemp(list: Candidate[]) {
  let hot = 0;
  let warm = 0;
  for (const c of list) {
    if (c.temp === "hot") hot++;
    else if (c.temp === "warm") warm++;
  }
  return { hot, warm };
}

/**
 * Main service — returns candidates and meta.
 * Exported as default because some callers import default.
 */
export default async function findBuyers(raw: Partial<FindBuyersInput>): Promise<{
  candidates: Candidate[];
  meta: Record<string, unknown>;
}> {
  const input = normalizeInput(raw);

  // Tiny on-disk cache to avoid re-hitting LLMs/external services for identical queries
  const key = makeKey({
    supplier: input.supplier,
    region: input.region,
    radiusMi: input.radiusMi,
    persona: input.persona, // already normalized
  });

  const cached = await cacheGet<{ candidates: Candidate[]; meta?: Record<string, unknown> }>(`fb:${key}`);
  if (cached?.candidates?.length) {
    const { hot, warm } = countByTemp(cached.candidates);
    return {
      candidates: cached.candidates,
      meta: { ...(cached.meta ?? {}), fromCache: true, hot, warm },
    };
  }

  const t0 = Date.now();
  const { candidates, meta } = await runProviders(input);

  const { hot, warm } = countByTemp(candidates);

  const payload = {
    candidates,
    meta: {
      ...(meta ?? {}),
      ms: Date.now() - t0,
      hot,
      warm,
    },
  };

  // fire-and-forget; do not block the response
  cacheSet(`fb:${key}`, payload).catch(() => void 0);

  return payload;
}