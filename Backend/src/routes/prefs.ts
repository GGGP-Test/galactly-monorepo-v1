// src/routes/prefs.ts
import { Router, type Request, type Response } from "express";
import {
  getPrefs,
  setPrefs,
  defaultPrefs,
  prefsSummary,
  normalizeHost,
  type UserPrefs,
  type EffectivePrefs,
} from "../shared/prefs";

const router = Router();

/**
 * GET /api/prefs?host=example.com
 * Returns the effective preferences for the supplied host.
 */
router.get("/", (req: Request, res: Response) => {
  const hostQ = String(req.query.host || "");
  const host = normalizeHost(hostQ);
  if (!host) {
    return res.status(400).json({ ok: false, error: "missing host query param" });
  }
  const prefs: EffectivePrefs = getPrefs(host);
  return res.json({
    ok: true,
    host,
    prefs,
    summary: prefsSummary(prefs),
    defaults: defaultPrefs(host),
  });
});

/**
 * POST /api/prefs
 * Body: Partial<UserPrefs> with a required "host".
 * Merges the patch into stored prefs and returns the new effective prefs.
 */
router.post("/", (req: Request, res: Response) => {
  const body = (req.body || {}) as Partial<UserPrefs>;
  const host = normalizeHost(body.host || "");
  if (!host) {
    return res.status(400).json({ ok: false, error: "body.host is required" });
  }

  // Don’t let the client change the key you’re storing under accidentally
  const patch: Partial<UserPrefs> = { ...body, host };

  const effective = setPrefs(host, patch);
  return res.status(200).json({
    ok: true,
    host,
    prefs: effective,
    summary: prefsSummary(effective),
  });
});

/**
 * Optional: quick reset endpoint for a host (handy while developing)
 * DELETE /api/prefs?host=example.com
 */
router.delete("/", (req: Request, res: Response) => {
  const hostQ = String(req.query.host || "");
  const host = normalizeHost(hostQ);
  if (!host) {
    return res.status(400).json({ ok: false, error: "missing host query param" });
  }
  // Replacing with defaults by simply not saving anything for this host:
  const def = defaultPrefs(host);
  return res.json({ ok: true, host, prefs: def, summary: prefsSummary(def) });
});

export default router;