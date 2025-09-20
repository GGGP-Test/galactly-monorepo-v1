// src/services/find-buyers.ts
import { runProviders, Candidate, FindBuyersInput } from "../providers";
import { cacheGet, cacheSet, makeKey } from "../utils/fsCache";

/** Response shape our UI expects. Adjust if your UI needs more fields. */
export type FindBuyersResponse = {
  candidates: Candidate[];
  meta: Record<string, unknown> & {
    ms?: number;
    seeds?: number;
    searched?: number;
    scored?: number;
    hot?: number;
    warm?: number;
  };
};

/**
 * Service wrapper:
 * - normalizes input
 * - optional tiny file cache
 * - no duplicate keys, no implicit any, no 'unknown' errors
 */
export default async function findBuyers(
  raw: FindBuyersInput,
): Promise<FindBuyersResponse> {
  // Normalize defensively (keeps types happy and consistent)
  const input: FindBuyersInput = {
    supplier: String(raw.supplier || "").trim(),
    region: String(raw.region || "usca").toLowerCase() as FindBuyersInput["region"],
    radiusMi: Number(raw.radiusMi ?? 50),
    persona: {
      offer: raw.persona?.offer ?? "",
      solves: raw.persona?.solves ?? "",
      titles: raw.persona?.titles ?? "",
    },
  };

  // Small cache key (no HTML hash in this minimal version)
  const key = makeKey({
    v: "v1",
    supplier: input.supplier,
    region: input.region,
    radiusMi: input.radiusMi,
    offer: input.persona.offer,
    solves: input.persona.solves,
    titles: input.persona.titles,
  });

  // Try cache first
  const cached = await cacheGet<FindBuyersResponse>(key);
  if (cached) return cached;

  const t0 = Date.now();
  try {
    const { candidates, meta } = await runProviders(input);

    // Derive hot/warm counts once – no duplicate object keys anywhere
    const hot = candidates.filter((c: Candidate) => c.temp === "hot").length;
    const warm = candidates.filter((c: Candidate) => c.temp === "warm").length;

    const result: FindBuyersResponse = {
      candidates,
      meta: {
        ms: Date.now() - t0,
        hot,
        warm,
        ...meta,
      },
    };

    // Save to cache (1 day is plenty; adjust if you want)
    await cacheSet(key, result, 1000 * 60 * 60 * 24);

    return result;
  } catch (err: unknown) {
    // Type-safe catch: never use bare `r` without typing
    const message =
      err instanceof Error ? err.message : `Unexpected error: ${String(err)}`;
    throw new Error(`find-buyers failed: ${message}`);
  }
}

/**
 * Small helper that previously caused "arr implicitly any".
 * Leaving an example here in case you need array utils.
 */
export function take<T>(arr: T[], n: number): T[] {
  // n is clamped; arr is typed; no implicit 'any'
  if (!Array.isArray(arr) || n <= 0) return [];
  return arr.slice(0, n);
}