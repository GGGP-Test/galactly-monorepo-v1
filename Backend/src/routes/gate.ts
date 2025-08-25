import { Router, Request, Response } from "express";
import { issueSession } from "../auth";

export const gateRouter = Router();

// POST /api/v1/onboard  { email, listMe?, company?, site? }
gateRouter.post("/onboard", (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "email" });
  }

  // TODO: store intent (email, listMe, company, site) if you want
  const auto = process.env.AUTO_VERIFY_EMAIL === "1";
  if (auto) {
    const session = issueSession(email);
    return res.json({ ok: true, session });
  }

  // REAL email flow would go here (send magic-link)
  // For now, behave like queued:
  return res.json({ ok: true, pending: true });
});

// GET /api/v1/onboard/verify?token=...
gateRouter.get("/onboard/verify", (req: Request, res: Response) => {
  // stub: not used when AUTO_VERIFY_EMAIL=1
  return res.status(501).json({ ok: false, error: "not-implemented" });
});

export default gateRouter;
