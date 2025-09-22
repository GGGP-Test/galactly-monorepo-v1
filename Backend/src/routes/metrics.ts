import { Router } from "express";

export const metricsRouter = Router();

/**
 * Very small in-memory “FOMO counters”.
 * - GET /api/v1/metrics/watchers?host=news.google.com
 *   -> { ok:true, watching: number, competing: number }
 *
 * These are demo-style, non-zero, time-varying but stable for a short
 * window so the UI doesn’t flicker. They do NOT require an API key.
 */

// Helper: seeded pseudo-random [0,1) from a string + time bucket
function seedRand(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // xorshift
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  // keep positive
  const u = (h >>> 0) / 4294967296;
  return u - Math.floor(u); // [0,1)
}

// Choose a min/max band that never returns 0.
// Nights are lower; days are higher, still > 0.
function bandForHour(hour: number) {
  // 0-23
  if (hour >= 0 && hour < 6) return { min: 2, max: 6 };
  if (hour < 12) return { min: 4, max: 12 };
  if (hour < 18) return { min: 6, max: 18 };
  return { min: 3, max: 10 };
}

// GET /watchers?host=...
metricsRouter.get("/watchers", (req, res) => {
  const host = String(req.query.host || "").trim().toLowerCase();
  if (!host) {
    return res.status(400).json({ ok: false, error: "host is required" });
  }

  // bucket by current hour so values update over time but are stable within the hour
  const now = new Date();
  const hour = now.getUTCHours();
  const { min, max } = bandForHour(hour);

  // derive two independent-looking numbers from different seeds
  const r1 = seedRand(`${host}|${hour}|w1`);
  const r2 = seedRand(`${host}|${hour}|w2`);

  const watching = Math.floor(min + r1 * (max - min));       // viewers/interest
  const competing = Math.max(1, Math.floor(1 + r2 * Math.max(2, Math.round(watching * 0.4)))); // “other suppliers”

  res.json({ ok: true, watching, competing, host });
});

/**
 * (Optional) You can extend with:
 *  - POST /lock to register a short-lived lock (requires x-api-key)
 *  - GET /saved to return counts of user-saved/locked leads
 * For now, the UI only needs /watchers.
 */