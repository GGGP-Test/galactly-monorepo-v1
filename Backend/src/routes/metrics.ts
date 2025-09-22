// src/routes/metrics.ts
import { Router } from "express";

const router = Router();

/**
 * NOTE:
 *  - GET /api/v1/metrics/watchers?host=example.com
 *    returns a demo "watching" counter (>0) for FOMO UI.
 *  - This endpoint does NOT require x-api-key (read-only and harmless).
 *  - We intentionally never return 0 to avoid “empty” UI.
 */

// simple minute bucket for changing numbers and lower values at night
function minuteBucket(now = new Date()) {
  return Math.floor(now.getTime() / 60_000);
}

function hashToInt(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function demoWatchers(host: string, now = new Date()): number {
  const bucket = minuteBucket(now);
  const seed = `${host}|${bucket}`;
  const base = hashToInt(seed) % 17; // 0..16
  // reduce a bit at night (00–06)
  const hour = now.getUTCHours();
  const nightFactor = hour >= 0 && hour < 6 ? 0.5 : 1;
  let n = Math.round((base + 2) * nightFactor); // min 1.. approx 18
  if (n < 1) n = 1; // never show zero
  return n;
}

router.get("/watchers", (req, res) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ ok: false, error: "host is required" });
  const watching = demoWatchers(host);
  res.json({ ok: true, watching });
});

// Optional: tiny endpoint you can ping if you want a summary widget later
router.get("/fomo", (req, res) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ ok: false, error: "host is required" });
  const watching = demoWatchers(host);
  res.json({ ok: true, host, metrics: { watching } });
});

export default router;