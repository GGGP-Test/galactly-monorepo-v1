// Backend/src/routes/quota.ts
//
// Thin Quota API wrapper around shared/quota-store.
// Endpoints:
//   • GET  /api/quota/                 -> help + (optional quick peek if ?email= is provided)
//   • GET  /api/quota/help             -> same help
//   • GET  /api/quota/peek?email=... [&plan=free|pro|vip|bundle] [&limit=number]
//   • POST /api/quota/bump { email, plan?, inc?, limit? }  (requires x-admin-key)
//
// NOTE: "bundle" is treated as VIP for limits/logic, but the TYPE we pass into quota-store
//       remains "free" | "pro" | "vip" to satisfy TypeScript.

import express, { Request, Response } from "express";
import { quota } from "../shared/quota-store";

const router = express.Router();

// IMPORTANT: keep the type EXACTLY as quota-store expects.
type Plan = "free" | "pro" | "vip";

// Accept user inputs including "bundle", but map to a valid Plan.
function parsePlanInput(v: unknown): Plan {
  const s = String(v || "").toLowerCase();
  if (s === "vip" || s === "bundle") return "vip";
  return s === "pro" ? "pro" : "free";
}

function defaultLimit(plan: Plan): number {
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
  if (process.env.ALLOW_TEST === "1") {
    console.warn("[quota] ADMIN_KEY not set; honoring request due to ALLOW_TEST=1");
    return true;
  }
  return false;
}

function helpJSON() {
  return {
    ok: true,
    service: "quota",
    routes: {
      ping:       "GET /api/quota/_ping",
      root_help:  "GET /api/quota (this document) or /api/quota/help",
      peek:       "GET /api/quota/peek?email=you@example.com&plan=pro|vip|free&limit=number(optional)",
      bump:       "POST /api/quota/bump { email, plan?, inc?, limit? }  (header x-admin-key required)"
    },
    plans: { free: 3, pro: 25, vip_or_bundle: 100 }
  };
}

// ---- ping ------------------------------------------------------------------
router.get("/_ping", (_req, res) => res.status(200).json({ ok: true, service: "quota" }));

// ---- root help (and optional quick peek if ?email= present) ----------------
router.get("/", async (req: Request, res: Response) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(200).json(helpJSON());

  const plan = parsePlanInput(req.query.plan);
  const limit = toInt(req.query.limit, defaultLimit(plan));
  try {
    const result = await quota.peek(email, plan, { limit });
    return res.status(200).json({ ok: true, ...result, note: "root quick-peek" });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "server", detail: err?.message || String(err) });
  }
});

router.get("/help", (_req: Request, res: Response) => res.status(200).json(helpJSON()));

// ---- peek ------------------------------------------------------------------
router.get("/peek", async (req: Request, res: Response) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: false, error: "missing_email" });

    const plan = parsePlanInput(req.query.plan || req.headers["x-user-plan"]);
    const limit = toInt(req.query.limit, defaultLimit(plan));

    const result = await quota.peek(email, plan, { limit });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "server", detail: err?.message || String(err) });
  }
});

// ---- bump (admin) ----------------------------------------------------------
router.post("/bump", express.json(), async (req: Request, res: Response) => {
  try {
    if (!adminAllowed(req)) {
      return res.status(200).json({ ok: false, error: "forbidden", detail: "x-admin-key required" });
    }
    const body = req.body || {};
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return res.status(200).json({ ok: false, error: "missing_email" });

    const plan = parsePlanInput(body.plan || req.headers["x-user-plan"]);
    const inc = toInt(body.inc, 1);
    const limit = toInt(body.limit, defaultLimit(plan));

    const result = await quota.bump(email, plan, inc, { limit });
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "server", detail: err?.message || String(err) });
  }
});

export default router;