// Minimal scoring logic with no external deps.
// Keeps the types that showed in your error logs (spent/cap/remaining).

export type CostMeta = Record<string, unknown>;
export type Score = { spent: number; cap: number; remaining: number };

export async function computeScore(input: {
  tenantId: string;
  usd: number;
  meta?: CostMeta;
}): Promise<Score> {
  // Example: hard cap of 1000; treat "usd" as spend
  const cap = 1000;
  const spent = Math.max(0, Math.min(cap, Math.round(input.usd || 0)));
  return { spent, cap, remaining: cap - spent };
}
