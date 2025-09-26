// src/routes/prefs.ts
import { Router, Request, Response } from "express";
import {
  getPrefs,
  setPrefs,
  defaultPrefs,
  normalizeHost,
  prefsSummary,
  type UserPrefs,
  type EffectivePrefs,
} from "../shared/prefs";

export const PrefsRouter = Router();

/**
 * GET /api/prefs?host=example.com
 * Returns the effective prefs for a supplier host.
 */
PrefsRouter.get("/", (req: Request, res: Response) => {
  const hostRaw = String(req.query.host ?? "").trim();
  if (!hostRaw) return res.status(400).json({ error: "host required" });

  const prefs = getPrefs(hostRaw);
  return res.json({ ok: true, prefs, summary: prefsSummary(prefs) });
});

/**
 * PUT /api/prefs
 * Body: Partial<UserPrefs> with `host` (or host=? in query)
 * Merges the patch into stored prefs and returns the effective prefs.
 */
PrefsRouter.put("/", (req: Request, res: Response) => {
  const host = normalizeHost(
    String((req.body?.host ?? req.query.host ?? "") as string).trim()
  );
  if (!host) return res.status(400).json({ error: "host required" });

  // accept a partial patch; we ignore any provided host inside the patch
  const patch = { ...(req.body || {}) } as Partial<UserPrefs>;
  delete (patch as any).host;

  const prefs = setPrefs(host, patch);
  return res.json({ ok: true, prefs, summary: prefsSummary(prefs) });
});

/**
 * GET /api/prefs/default?host=example.com
 * Returns the platform defaults for a normalized host without touching store.
 */
PrefsRouter.get("/default", (req: Request, res: Response) => {
  const hostRaw = String(req.query.host ?? "").trim();
  if (!hostRaw) return res.status(400).json({ error: "host required" });

  const host = normalizeHost(hostRaw);
  const prefs = defaultPrefs(host);
  return res.json({ ok: true, prefs, summary: prefsSummary(prefs) });
});

export default PrefsRouter;