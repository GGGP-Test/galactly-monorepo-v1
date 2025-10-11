// src/routes/claim.ts
//
// Own & Hide endpoints
// - POST /api/claim/own  { host, url?, note? }   -> Pro & VIP
// - POST /api/claim/hide { host, reason? }       -> VIP only
// Counters reset daily (in-memory). Env is optional.
//
// Optional env knobs (you DON'T need to set these now):
//   OWN_PRO_DAILY   (default 10)
//   OWN_VIP_DAILY   (default 100)
//   HIDE_VIP_DAILY  (default 20)

import { Router, Request, Response } from "express";
import withPlan from "../middleware/with-plan";

type Counts = { owns: number; hides: number; dayKey: string };
const store = new Map<string, Counts>(); // key = email

function dayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
}

function getCaps(tier: "free"|"pro"|"vip") {
  const n = (v: any, d: number) => {
    const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    proOwn: n(process.env.OWN_PRO_DAILY, 10),
    vipOwn: n(process.env.OWN_VIP_DAILY, 100),
    vipHide: n(process.env.HIDE_VIP_DAILY, 20),
    tier,
  };
}

function bucket(email: string): Counts {
  const k = dayKey();
  const cur = store.get(email);
  if (!cur || cur.dayKey !== k) {
    const fresh = { owns: 0, hides: 0, dayKey: k };
    store.set(email, fresh);
    return fresh;
  }
  return cur;
}

const router = Router();
router.use(withPlan()); // attaches req.plan + x-plan-tier header

router.get("/_ping", (_req, res) => res.json({ ok: true, where: "claim" }));

router.post("/own", (req: Request, res: Response) => {
  const email = req.userEmail || "";
  const plan = req.plan!;
  const host = String(req.body?.host || "").trim();

  if (!host) return res.status(400).json({ ok: false, error: "host-required" });

  if (plan.tier === "free") {
    return res.status(402).json({ ok: false, error: "upgrade-required", need: "pro" });
  }

  const caps = getCaps(plan.tier);
  const c = bucket(email);

  const limit = plan.tier === "vip" ? caps.vipOwn : caps.proOwn;
  if (c.owns >= limit) {
    return res.status(429).json({
      ok: false,
      error: "own-daily-limit",
      limit,
      used: c.owns,
      resetAt: `${c.dayKey}T23:59:59Z`
    });
  }

  c.owns += 1;
  // (Future: persist to DB / audit log)
  return res.json({
    ok: true,
    action: "own",
    host,
    plan: plan.tier,
    counts: { owns: c.owns, hides: c.hides },
  });
});

router.post("/hide", (req: Request, res: Response) => {
  const email = req.userEmail || "";
  const plan = req.plan!;
  const host = String(req.body?.host || "").trim();

  if (!host) return res.status(400).json({ ok: false, error: "host-required" });

  if (plan.tier !== "vip") {
    return res.status(402).json({ ok: false, error: "upgrade-required", need: "vip" });
  }

  const caps = getCaps(plan.tier);
  const c = bucket(email);

  const limit = caps.vipHide;
  if (c.hides >= limit) {
    return res.status(429).json({
      ok: false,
      error: "hide-daily-limit",
      limit,
      used: c.hides,
      resetAt: `${c.dayKey}T23:59:59Z`
    });
  }

  c.hides += 1;
  // (Future: persist to DB / audit log)
  return res.json({
    ok: true,
    action: "hide",
    host,
    plan: plan.tier,
    counts: { owns: c.owns, hides: c.hides },
  });
});

export default router;