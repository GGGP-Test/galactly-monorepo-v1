import type { Request, Response } from "express";
import express from "express";

const router = express.Router();

/**
 * GET /api/v1/leads/diagnose
 * Reports env flags that commonly block discovery so we stop guessing.
 */
router.get("/diagnose", async (_req: Request, res: Response) => {
  const env = process.env;

  const flags = {
    DISCOVERY: env.DISCOVERY ?? env.DISCOVERY_ENABLED ?? env.LEADS_DISCOVERY ?? "",
    ALLOW_WEB: env.ALLOW_WEB ?? env.LEADS_ALLOW_WEB ?? "",
    SAFE_MODE: env.SAFE_MODE ?? "",
    DRY_RUN: env.DRY_RUN ?? "",
    NODE_ENV: env.NODE_ENV ?? ""
  };

  const truthy = (v: unknown) => typeof v === "string" ? /^(1|true|on|yes)$/i.test(v) : Boolean(v);
  const hints: string[] = [];

  if (!truthy(flags.DISCOVERY)) hints.push("Discovery flag is OFF");
  if (!truthy(flags.ALLOW_WEB)) hints.push("Web access flag is OFF (no external discovery)");
  if (truthy(flags.SAFE_MODE)) hints.push("SAFE_MODE is ON (may suppress discovery)");
  if (truthy(flags.DRY_RUN)) hints.push("DRY_RUN is ON (no writes/creates)");

  res.json({
    ok: hints.length === 0,
    flags,
    hints,
    note: "Set DISCOVERY=true, ALLOW_WEB=true, SAFE_MODE=false, DRY_RUN=false in Northflank if needed."
  });
});

export default router;