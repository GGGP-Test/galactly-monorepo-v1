import express, { Request, Response } from "express";
import pino from "pino";
import { z } from "zod";
import * as Audit from "../../security/audit-log";

const logger = pino();
const router = express.Router();

/** What the “score” endpoint returns. */
type Score = { spent: number; cap: number; remaining: number };

/** Minimal meta shape; extend to match your real model. */
type CostMeta = { capUsd: number };

/**
 * Be resilient to either a named export `auditLog`
 * or a default export from ../../security/audit-log.
 */
const auditLog: (...args: any[]) => void =
  ((Audit as any).auditLog as any) ??
  ((Audit as any).default as any) ??
  (() => undefined);

/** Pure function that *returns* the score object. */
export async function getScore(
  tenantId: string,
  usd: number,
  meta: CostMeta
): Promise<Score> {
  const cap = Number.isFinite(meta.capUsd) ? meta.capUsd : 1000;
  const spent = Math.max(0, usd);
  const remaining = Math.max(0, cap - spent);

  try {
    auditLog?.("score.computed", { tenantId, usd: spent, cap, remaining });
  } catch {
    // audit is best-effort; never fail the request because of logging
  }

  return { spent, cap, remaining };
}

/**
 * GET /api/score?tenantId=...&usd=...
 * Sends JSON and returns void (avoids the previous “void vs object” type mismatch).
 */
router.get("/api/score", async (req: Request, res: Response) => {
  const schema = z.object({
    tenantId: z.string().min(1),
    usd: z.coerce.number()
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { tenantId, usd } = parsed.data;

  // TODO: load CostMeta from DB/config; default for now
  const meta: CostMeta = { capUsd: 1000 };

  try {
    const data = await getScore(tenantId, usd, meta);
    res.json(data); // send the object; do not return it
  } catch (err) {
    logger.error({ err }, "failed to compute score");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
