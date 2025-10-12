// Backend/src/routes/quota.ts
//
// Thin Quota API wrapper around shared/quota-store.
// - GET  /api/quota/peek?email=... [&plan=free|pro|vip] [&limit=number]
// - POST /api/quota/bump { email, plan?, inc?, limit? }   (requires x-admin-key)
// Notes:
//   • Plan limits default to free=3, pro=25, vip=100 unless an explicit limit is passed.
//   • Admin guard: header x-admin-key must match process.env.ADMIN_KEY.
//     In dev, if ALLOW_TEST=1 and no ADMIN_KEY is set, we allow and log a warning.

import express, { Request, Response } from "express";
import { quota } from "../shared/quota-store";

const router = express.Router();

// ---- helpers ---------------------------------------------------------------

type PlanCode = "free" | "pro" | "vip";

function parsePlan(v: unknown): PlanCode {
  const s = String(v || "").toLowerCase();
  return s === "pro" ? "pro" : s === "vip" ? "vip" : "free";
}
function defaultLimit(plan: PlanCode): number {
  return plan === "vip" ? 100 : plan === "pro" ? 25 : 3;
}
function toInt(n: unknown, d = 0): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
}
function adminAllowed(req: Request): boolean {
  const hdr = String(req.headers["x-admin-key"] || "");
  const envKey = process.env.ADMIN_KEY || "";
  if (envKey) return hdr === envKey;
  // No ADMIN_KEY set — allow in dev if ALLOW_TEST=1
  if (process.env.ALLOW_TEST === "1") {
    console.warn("[quota] ADMIN_KEY not set; honoring request due to ALLOW_TEST=1");
    return true;
  }
  return false;
}

// ---- routes ----------------------------------------------------------------

router.get("/peek", async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: false, error: "missing_email" });

    const plan = parsePlan(req.query.plan || req.headers["x-user-plan"]);
    const limit = toInt(req.query.limit, defaultLimit(plan));

    const result = await quota.peek(email, plan, { limit });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "server", detail: err?.message || String(err) });
  }
});

router.post("/bump", express.json(), async (req: Request, res: Response) => {
  try {
    if (!adminAllowed(req)) {
      return res.status(200).json({ ok: false, error: "forbidden", detail: "x-admin-key required" });
    }

    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: false, error: "missing_email" });

    const plan = parsePlan(body.plan || req.headers["x-user-plan"]);
    const inc = toInt(body.inc, 1);
    const limit = toInt(body.limit, defaultLimit(plan));

    const result = await quota.bump(email, plan, inc, { limit });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "server", detail: err?.message || String(err) });
  }
});

// Lightweight ping for ops checks
router.get("/_ping", (_req, res) => res.status(200).json({ ok: true, service: "quota" }));

export default router;