/**
 * Lightweight scoring utilities and optional route hook.
 * Does NOT import Express; uses 'any' to avoid adding deps.
 */

export type CostMeta = {
  cap?: number;          // monthly cap in USD
  floor?: number;        // minimum charge
};

export type Score = {
  spent: number;
  cap: number;
  remaining: number;
};

export function scoreTenant(
  tenantId: string,
  usd: number,
  meta: CostMeta = {}
): Score {
  const cap = Number.isFinite(meta.cap) ? (meta.cap as number) : 1000;
  const spent = Math.max(0, Math.min(usd, cap));
  const remaining = Math.max(0, cap - spent);
  return { spent, cap, remaining };
}

/**
 * If you *do* have an HTTP app, you can pass it here.
 * Works with Express-like frameworks without importing types.
 */
export function registerScoreRoutes(app: any): void {
  if (!app || typeof app.get !== "function") return;

  app.get("/api/score", (req: any, res: any) => {
    const usd = Number(req?.query?.usd ?? 0);
    const tenantId = String(req?.query?.tenantId ?? "default");
    const cap = req?.query?.cap ? Number(req.query.cap) : undefined;

    const result = scoreTenant(tenantId, usd, { cap });
    if (res?.json) return res.json(result);
    if (res?.send) return res.send(result);
  });
}
