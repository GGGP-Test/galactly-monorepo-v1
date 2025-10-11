// src/routes/gate.ts
// Gate endpoints: simple plan/limits visibility + your onboarding flow.
// No DB required. Reads headers + env. Exposes health pings for quick checks.

import { Router, Request, Response } from "express";
import { issueSession } from "../auth";

const router = Router();

/* ----------------- tiny helpers ----------------- */
function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function flag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/* ----------------- env snapshot ----------------- */
const ENV = {
  windowDays: num(process.env.QUOTA_WINDOW_DAYS, 1),
  freeDaily:  num(process.env.FREE_DAILY, 3),
  proDaily:   num(process.env.PRO_DAILY, 25),
  vipDaily:   num(process.env.VIP_DAILY, 50),     // optional; safe default
  disabled:   flag(process.env.QUOTA_DISABLE),     // 1 disables quotas entirely
  autoVerify: process.env.AUTO_VERIFY_EMAIL === "1",
};

/* ----------------- plan resolver ----------------- */
function resolvePlan(req: Request): "free" | "pro" | "vip" | "test" | "internal" {
  const h =
    (req.header("x-plan") ||
      req.header("x-user-plan") ||
      "").toLowerCase();

  if (h === "pro" || h === "vip" || h === "test" || h === "internal") return h as any;
  return "free";
}

/* ----------------- health/ping ----------------- */
router.get("/", (_req, res) => {
  res.json({ ok: true, service: "gate", now: new Date().toISOString() });
});

router.get("/_ping", (_req, res) => {
  res.type("text/plain").send("gate-ok");
});

/* ----------------- visibility helpers ----------------- */
router.get("/whoami", (req: Request, res: Response) => {
  const plan = resolvePlan(req);
  const email = (req.header("x-user-email") || "").trim() || undefined;
  const apiKey = (req.header("x-api-key") || "").trim() || undefined;

  res.json({
    ok: true,
    plan,
    email,
    apiKeyPresent: !!apiKey,
    note: "This is header-inferred. Real billing state is synced via Stripe webhooks.",
  });
});

router.get("/limits", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    disabled: ENV.disabled,
    windowDays: ENV.windowDays,
    perPlan: {
      free: ENV.freeDaily,
      pro:  ENV.proDaily,
      vip:  ENV.vipDaily,
    },
  });
});

/* ----------------- your onboarding flow ----------------- */
// POST /api/v1/onboard  { email, listMe?, company?, site? }
router.post("/onboard", (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "email" });
  }

  // TODO: store intent (email, listMe, company, site) if desired.
  if (ENV.autoVerify) {
    const session = issueSession(email);
    return res.json({ ok: true, session });
  }

  // If not auto-verify, you'd send a magic link here.
  return res.json({ ok: true, pending: true });
});

// GET /api/v1/onboard/verify?token=...
router.get("/onboard/verify", (_req: Request, res: Response) => {
  // stub: not used when AUTO_VERIFY_EMAIL=1
  return res.status(501).json({ ok: false, error: "not-implemented" });
});

export default router;