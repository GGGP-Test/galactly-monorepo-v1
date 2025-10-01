// src/routes/prefs.ts
//
// Preference API used by the Free Panel and internal tools.
// Endpoints (all JSON):
//   GET  /api/prefs/get?host=acme.com           -> { ok, prefs }
//   GET  /api/prefs/effective?host=acme.com     -> { ok, prefs }
//   GET  /api/prefs/summary?host=acme.com       -> { ok, summary }
//   POST /api/prefs/upsert { host, ...patch }   -> { ok, prefs }
// Aliases:
//   POST /api/prefs/apply  (same as /upsert)

import { Router, Request, Response } from "express";
import {
  getPrefs,
  setPrefs,
  defaultPrefs,
  prefsSummary,
} from "../shared/prefs";

const r = Router();

/* ------------------------------- helpers ---------------------------------- */

function bad(res: Response, msg: string, code = 400) {
  return res.status(code).json({ ok: false, error: msg });
}

function normHost(raw?: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

/* -------------------------------- routes ---------------------------------- */

// Read effective prefs (canonical)
r.get("/effective", (req: Request, res: Response) => {
  const host = normHost(String(req.query.host || ""));
  if (!host) return bad(res, "host_required");
  const prefs = getPrefs(host);
  return res.json({ ok: true, prefs });
});

// Friendly alias for UIs expecting /get
r.get("/get", (req: Request, res: Response) => {
  const host = normHost(String(req.query.host || ""));
  if (!host) return bad(res, "host_required");
  const prefs = getPrefs(host);
  return res.json({ ok: true, prefs });
});

// Human-readable summary (useful for debugging/logging)
r.get("/summary", (req: Request, res: Response) => {
  const host = normHost(String(req.query.host || ""));
  if (!host) return bad(res, "host_required");
  const eff = getPrefs(host);
  return res.json({ ok: true, summary: prefsSummary(eff) });
});

// Upsert from UI (Apply)
r.post("/upsert", (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const host = normHost(String(body.host || ""));
  if (!host) return bad(res, "host_required");

  // Apply patch safely; setPrefs returns EffectivePrefs
  const prefs = setPrefs(host, body as any);
  return res.json({ ok: true, prefs });
});

// Alias: some clients may call /apply
r.post("/apply", (req: Request, res: Response) => {
  (r as any).handle({ ...req, url: "/upsert" }, res);
});

/* ---------------------------- safe defaults ------------------------------- */

// Optional convenience to bootstrap defaults without writing:
// GET /api/prefs/defaults?host=acme.com
r.get("/defaults", (req: Request, res: Response) => {
  const host = normHost(String(req.query.host || ""));
  if (!host) return bad(res, "host_required");
  return res.json({ ok: true, prefs: defaultPrefs(host) });
});

export default r;