import { Router } from "express";
import memStore from "../shared/memStore";

const router = Router();

/**
 * Simple health/ping
 */
router.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * GET /api/v1/metrics/watchers?host=example.com
 * Returns how many users are "watching" a host (toy metric for the panel).
 */
router.get("/watchers", (req, res) => {
  const host = String(req.query.host || "").trim().toLowerCase();
  const watching = memStore.getWatchers(host);
  res.json({ ok: true, host, watching });
});

/**
 * POST /api/v1/metrics/claim
 * Body: { host?: string }
 * Used by the panel when you click "Lock & keep". We just bump a counter.
 * Always returns 200 to avoid UI errors.
 */
router.post("/claim", (req, res) => {
  const host = String((req.body?.host ?? req.query?.host ?? "")).trim().toLowerCase();
  if (host) memStore.incWatcher(host, 1);
  res.json({ ok: true, host, watching: memStore.getWatchers(host) });
});

/**
 * GET /api/v1/metrics/deepen?host=example.com
 * The panel probes this after "Deepen results". For now we return a benign 200.
 */
router.get("/deepen", (req, res) => {
  const host = String(req.query.host || "").trim().toLowerCase();
  // no-op placeholder; respond 200 so the UI doesn't show a red error
  res.json({ ok: true, host, added: 0, message: "Nothing more to add right now." });
});

export default router;