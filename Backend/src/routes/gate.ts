// src/routes/gate.ts
//
// Gate & session endpoints (health + plan info + onboarding).
// Mount path in index.ts:  app.use("/api/v1", GateRouter);

import { Router, Request, Response } from "express";
import withPlan from "../middleware/with-plan";
import { issueSession } from "../auth"; // your existing helper

const gate = Router();

/** quick health check */
gate.get("/_ping", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "gate", ts: new Date().toISOString() });
});

/** attach plan info (email -> plan) for the routes below */
gate.use(withPlan());

/** whoami: echo inferred email + plan */
gate.get("/whoami", (req: Request, res: Response) => {
  res.json({
    ok: true,
    email: req.userEmail || null,
    plan: req.plan?.tier || "free",
    dailyLimit: req.plan?.dailyLimit ?? 3,
    canHide: !!req.plan?.canHide,
  });
});

/** limits: show current daily limits for UI/debug */
gate.get("/limits", (req: Request, res: Response) => {
  res.json({
    ok: true,
    limits: {
      dailyFindBuyers: req.plan?.dailyLimit ?? 3,
      windowDays: Number(process.env.QUOTA_WINDOW_DAYS || 1),
    },
    plan: req.plan?.tier || "free",
  });
});

/** GET /onboard — friendly hint (your browser did a GET earlier) */
gate.get("/onboard", (_req: Request, res: Response) => {
  const auto = process.env.AUTO_VERIFY_EMAIL === "1";
  res.json({
    ok: true,
    hint: "POST { email } to /api/v1/onboard",
    autoVerify: auto,
  });
});

/** POST /onboard  { email, listMe?, company?, site? } */
gate.post("/onboard", (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "email" });
  }

  // (optional) persist intent here: email, listMe, company, site

  const auto = process.env.AUTO_VERIFY_EMAIL === "1";
  if (auto) {
    const session = issueSession(email);
    return res.json({ ok: true, session });
  }
  // If you later add magic-link flow, handle it here
  return res.json({ ok: true, pending: true });
});

/** placeholder if you later wire magic-link verification */
gate.get("/onboard/verify", (_req: Request, res: Response) => {
  return res.status(501).json({ ok: false, error: "not-implemented" });
});

export default gate;