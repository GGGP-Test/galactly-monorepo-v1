// src/routes/claim.ts
//
// Claim / Hide (persistent).
// Endpoints:
//   GET  /api/claim/_ping
//   GET  /api/claim/limits
//   GET  /api/claim/status?host=acme.com
//   POST /api/claim/own     { host }    // Pro or VIP
//   POST /api/claim/hide    { host }    // VIP only
//   POST /api/claim/unhide  { host }    // VIP only
//
// Persists via shared/claim-store (Postgres if available, else in-memory).

import { Router, Request, Response } from "express";
import { planForReq, dailyLimit, isPro, isVip } from "../shared/plan";
import { getStatus, own as storeOwn, hide as storeHide, unhide as storeUnhide } from "../shared/claim-store";

const r = Router();

function needEmail(req: Request, res: Response): string | null {
  const email = String(req.headers["x-user-email"] || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    res.status(401).json({ ok: false, error: "no-email", detail: "x-user-email header required" });
    return null;
  }
  return email;
}

function hostFrom(req: Request): string {
  return String((req.body && (req.body as any).host) || req.query.host || "").trim();
}

/* -------------------- routes -------------------- */

r.get("/_ping", (_req, res) => {
  res.json({ ok: true, route: "claim", now: new Date().toISOString() });
});

r.get("/limits", async (req, res) => {
  const { email, plan } = await planForReq(req);
  res.json({
    ok: true,
    email,
    plan,
    dailyLimit: dailyLimit(plan),
    canHide: isVip(plan),
  });
});

r.get("/status", async (req, res) => {
  try {
    const hostRaw = hostFrom(req);
    if (!hostRaw) return res.status(400).json({ ok: false, error: "host" });

    const rec = (await getStatus(hostRaw)) || { host: hostRaw, owner: null, ownedAt: null, hiddenBy: null, hiddenAt: null };
    res.json({ ok: true, ...rec });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "status-failed", detail: String(e?.message || e) });
  }
});

r.post("/own", async (req, res) => {
  try {
    const { plan } = await planForReq(req);
    const email = needEmail(req, res); if (!email) return;
    if (!isPro(plan)) return res.status(403).json({ ok: false, error: "plan", detail: "Pro or VIP required" });

    const hostRaw = hostFrom(req);
    if (!hostRaw) return res.status(400).json({ ok: false, error: "host" });

    const { rec, conflictOwner } = await storeOwn(hostRaw, email);
    if (conflictOwner && conflictOwner !== email) {
      return res.status(409).json({ ok: false, error: "owned", owner: conflictOwner });
    }
    res.json({ ok: true, ...rec });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "own-failed", detail: String(e?.message || e) });
  }
});

r.post("/hide", async (req, res) => {
  try {
    const { plan } = await planForReq(req);
    const email = needEmail(req, res); if (!email) return;
    if (!isVip(plan)) return res.status(403).json({ ok: false, error: "plan", detail: "VIP required" });

    const hostRaw = hostFrom(req);
    if (!hostRaw) return res.status(400).json({ ok: false, error: "host" });

    const rec = await storeHide(hostRaw, email);
    res.json({ ok: true, ...(rec || { host: hostRaw }) });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "hide-failed", detail: String(e?.message || e) });
  }
});

r.post("/unhide", async (req, res) => {
  try {
    const { plan } = await planForReq(req);
    const email = needEmail(req, res); if (!email) return; // still require auth header
    if (!isVip(plan)) return res.status(403).json({ ok: false, error: "plan", detail: "VIP required" });

    const hostRaw = hostFrom(req);
    if (!hostRaw) return res.status(400).json({ ok: false, error: "host" });

    const rec = await storeUnhide(hostRaw);
    res.json({ ok: true, ...(rec || { host: hostRaw, hiddenBy: null, hiddenAt: null }) });
  } catch (e: any) {
    res.status(200).json({ ok: false, error: "unhide-failed", detail: String(e?.message || e) });
  }
});

export default r;