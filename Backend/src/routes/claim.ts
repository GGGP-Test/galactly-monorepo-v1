// src/routes/claim.ts
//
// Claim / Hide feature (MVP, in-memory).
// Endpoints (all JSON):
//   GET    /api/claim/_ping
//   GET    /api/claim/limits
//   GET    /api/claim/status?host=example.com
//   POST   /api/claim/own     { host }
//   POST   /api/claim/hide    { host }      // VIP only
//   POST   /api/claim/unhide  { host }      // VIP only
//
// Notes:
// - Uses shared/plan to determine the user's plan and daily limits.
// - Stores data in-memory for now (resets on deploy). Good enough for BV1.

import { Router, Request, Response } from "express";
import { planForReq, dailyLimit, isPro, isVip } from "../shared/plan";

type ClaimRecord = {
  owner?: string;        // email of claimer
  ownedAt?: number;      // ms epoch
  hiddenBy?: string;     // email who hid it (VIP)
  hiddenAt?: number;     // ms epoch
};

const r = Router();

// very small, in-memory “db”: host -> record
const CLAIMS = new Map<string, ClaimRecord>();

function normHost(raw: unknown): string {
  const h = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  return h;
}

function needEmail(req: Request, res: Response): string | null {
  const email = String(req.headers["x-user-email"] || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(401).json({ ok: false, error: "no-email", detail: "x-user-email header required" });
    return null;
  }
  return email;
}

/* ---------------------- routes ---------------------- */

r.get("/_ping", (_req: Request, res: Response) => {
  res.json({ ok: true, now: new Date().toISOString(), route: "claim" });
});

r.get("/limits", async (req: Request, res: Response) => {
  const { email, plan } = await planForReq(req);
  res.json({
    ok: true,
    email,
    plan,
    dailyLimit: dailyLimit(plan),
    canHide: isVip(plan),
  });
});

r.get("/status", (req: Request, res: Response) => {
  const host = normHost(req.query.host);
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const rec = CLAIMS.get(host) || {};
  res.json({
    ok: true,
    host,
    owner: rec.owner || null,
    ownedAt: rec.ownedAt || null,
    hiddenBy: rec.hiddenBy || null,
    hiddenAt: rec.hiddenAt || null,
  });
});

r.post("/own", async (req: Request, res: Response) => {
  const { plan } = await planForReq(req);
  const email = needEmail(req, res); if (!email) return;

  if (!isPro(plan)) {
    return res.status(403).json({ ok: false, error: "plan", detail: "Pro or VIP required" });
  }

  const host = normHost(req.body?.host);
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const rec = CLAIMS.get(host) || {};
  if (rec.owner && rec.owner !== email) {
    return res.status(409).json({ ok: false, error: "owned", owner: rec.owner });
  }

  rec.owner = email;
  rec.ownedAt = Date.now();
  CLAIMS.set(host, rec);

  res.json({ ok: true, host, owner: email, ownedAt: rec.ownedAt });
});

r.post("/hide", async (req: Request, res: Response) => {
  const { plan } = await planForReq(req);
  const email = needEmail(req, res); if (!email) return;

  if (!isVip(plan)) {
    return res.status(403).json({ ok: false, error: "plan", detail: "VIP required" });
  }

  const host = normHost(req.body?.host);
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const rec = CLAIMS.get(host) || {};
  rec.hiddenBy = email;
  rec.hiddenAt = Date.now();
  CLAIMS.set(host, rec);

  res.json({ ok: true, host, hiddenBy: email, hiddenAt: rec.hiddenAt });
});

r.post("/unhide", async (req: Request, res: Response) => {
  const { plan } = await planForReq(req);
  const email = needEmail(req, res); if (!email) return;

  if (!isVip(plan)) {
    return res.status(403).json({ ok: false, error: "plan", detail: "VIP required" });
  }

  const host = normHost(req.body?.host);
  if (!host) return res.status(400).json({ ok: false, error: "host" });

  const rec = CLAIMS.get(host) || {};
  rec.hiddenBy = undefined;
  rec.hiddenAt = undefined;
  CLAIMS.set(host, rec);

  res.json({ ok: true, host, hiddenBy: null, hiddenAt: null });
});

export default r;