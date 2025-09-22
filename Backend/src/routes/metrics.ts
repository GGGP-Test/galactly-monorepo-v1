import { Router } from "express";
import crypto from "crypto";

export const metricsRouter = Router();

/**
 * Synthetic “who’s watching this lead” counter.
 * - Always >= 1 (never shows zero).
 * - Deterministic per host + minute bucket + secret salt.
 * - Scaled by time of day to feel quieter at night.
 */
function watchersForHost(host: string): number {
  const now = new Date();
  const hour = now.getUTCHours(); // we don’t know user tz; UTC is fine for demo
  const minuteBucket = Math.floor(now.getUTCMinutes() / 5); // 12 buckets/hour

  const salt = process.env.ADMIN_TOKEN || "gx-salt";
  const h = crypto
    .createHash("sha256")
    .update(`${host}|${hour}|${minuteBucket}|${salt}`)
    .digest();

  // base in [0..1)
  const base = h[0] / 255;

  // day-part scaling (quieter overnight UTC)
  const dayScale = hour >= 6 && hour <= 20 ? 1.0 : 0.45;

  // convert to a small integer range with jitter
  const min = 1;
  const max = 6; // keep modest for free panel
  const val = Math.floor(min + base * (max - min + 1));

  // tiny extra jitter from another byte so successive calls wiggle a bit
  const jitter = (h[1] % 2); // 0 or 1

  return Math.max(min, Math.round((val + jitter) * dayScale));
}

metricsRouter.get("/watchers", (req, res) => {
  const raw = String(req.query.host || "").trim();
  const host = raw || "unknown";
  const watching = watchersForHost(host);
  res.json({ ok: true, watching });
});

// future: public counters etc.