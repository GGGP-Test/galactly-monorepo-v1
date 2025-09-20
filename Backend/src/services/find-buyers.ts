import { runProviders, Candidate, FindBuyersInput } from "../providers";

/**
 * Public service used by the route handler.
 * Accepts a loose/partial payload, normalizes it to FindBuyersInput,
 * calls provider runners, and returns a clean response.
 */
export type FindBuyersServiceInput = Partial<FindBuyersInput>;

export type FindBuyersServiceResponse = {
  ok: true;
  created: number;
  candidates: Candidate[];
  meta: {
    ms: number;
    hot: number;
    warm: number;
    // provider-level extras are threaded through here
    [k: string]: unknown;
  };
};

function toTitlesString(value: unknown): string {
  // Frontend may send array; providers expect a single string (comma-separated).
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
}

export async function findBuyersService(
  raw: FindBuyersServiceInput
): Promise<FindBuyersServiceResponse> {
  const supplier = (raw?.supplier ?? "").toString().trim();
  if (!supplier) {
    throw new Error("supplier (domain) is required");
  }

  const input: FindBuyersInput = {
    supplier,
    region: (raw?.region ?? "usca").toString().toLowerCase(),
    radiusMi: Number(raw?.radiusMi ?? 50),
    persona: {
      offer: (raw?.persona?.offer ?? "").toString(),
      solves: (raw?.persona?.solves ?? "").toString(),
      titles: toTitlesString(raw?.persona?.titles), // ensure string, not string[]
    },
  };

  const t0 = Date.now();
  const { candidates, meta } = await runProviders(input);

  // IMPORTANT: candidates are typed as Candidate (has `temp`)
  const hot = candidates.filter((c) => c.temp === "hot").length;
  const warm = candidates.filter((c) => c.temp === "warm").length;

  // NOTE: Do NOT duplicate top-level `hot`/`warm` keys here.
  // Keep them *only* inside meta to avoid TS2783.
  return {
    ok: true,
    created: candidates.length,
    candidates,
    meta: {
      ms: Date.now() - t0,
      hot,
      warm,
      ...(meta || {}),
    },
  };
}

export default findBuyersService;