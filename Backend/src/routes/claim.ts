// src/routes/claim.ts
//
// Own / Hide API (with tiny daily counter).
// - GET  /api/claim/_ping
// - POST /api/claim/own   { host, note? }
// - POST /api/claim/hide  { host, note? }
//
// Uses: middleware/with-plan (to know email & plan)

import { Router, Request, Response } from "express";
import withPlan from "../middleware/with-plan";

const router = Router();

// attach userEmail + plan to every request
router.use(withPlan());

// in-memory daily counters (email + bucket)
type BucketKey = string; // `${email}|${bucket}|${day}`
type BucketVal = { used: number; resetAt: number };
const usage = new Map<BucketKey, BucketVal>();

function epochDay(ms: number) {
  const DAY = 24 * 60 * 60 * 1000;
  return Math.floor(ms / DAY);
}
function keyFor(email: string, bucket: string) {
  const now = Date.now();
  const k = `${email}|${bucket}|${epochDay(now)}`;
  const end = (epochDay(now) + 1) * 24 * 60 * 60 * 1000;
  return { k, resetAt: end };
}
function limitFor(tier: "free" | "pro" | "vip"): number {
  if (tier === "vip") return 100;
  if (tier === "pro") return Number(process.env.PRO_DAILY || 25);
  return Number(process.env.FREE_DAILY || 3);
}

router.get("/_ping", (_req, res) => res.json({ ok: true, name: "claim", ver: 1 }));

function validate(req: Request, res: Response) {
  const email = (req as any).userEmail as string | undefined;
  const plan = (req as any).plan as { tier: "free" | "pro" | "vip" } | undefined;
  const host = String(req.body?.host || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    res.status(400).json({ ok: false, error: "email-required" });
    return null;
  }
  if (!host) {
    res.status(400).json({ ok: false, error: "host-required" });
    return null;
  }
  const tier = (plan?.tier || "free") as "free" | "pro" | "vip";
  return { email, tier, host };
}

function checkAndBump(email: string, bucket: "own" | "hide", tier: "free" | "pro" | "vip") {
  const { k, resetAt } = keyFor(email, bucket);
  const lim = limitFor(tier);
  const cur = usage.get(k) || { used: 0, resetAt };
  // rollover
  if (cur.resetAt !== resetAt) { cur.used = 0; cur.resetAt = resetAt; }
  if (cur.used >= lim) return { ok: false as const, limit: lim, used: cur.used, resetAfterMs: Math.max(0, cur.resetAt - Date.now()) };
  cur.used += 1;
  usage.set(k, cur);
  return { ok: true as const, limit: lim, used: cur.used, remaining: Math.max(0, lim - cur.used) };
}

async function handleAction(req: Request, res: Response, action: "own" | "hide") {
  const v = validate(req, res);
  if (!v) return;
  const { email, tier, host } = v;

  const c = checkAndBump(email, action, tier);
  if (!c.ok) {
    return res.status(429).json({ ok: false, error: "DAILY_LIMIT", ...c, tier });
  }

  // (Logging will be wired to audit-log later; this endpoint just confirms.)
  return res.json({
    ok: true,
    action,
    host,
    tier,
    usedToday: c.used,
    remainingToday: c.remaining,
  });
}

router.post("/own",  (req, res) => { void handleAction(req, res, "own");  });
router.post("/hide", (req, res) => { void handleAction(req, res, "hide"); });

export default router;