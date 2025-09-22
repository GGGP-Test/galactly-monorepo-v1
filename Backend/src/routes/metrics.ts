import { Router, Request, Response } from "express";

/**
 * Temp buckets we show in the UI.
 */
export type Temp = "hot" | "warm" | "cold";

/**
 * Simple in-memory store (pod-local). Good enough for free-panel FOMO.
 * If you later want durable counts, we can put this behind Redis without
 * changing the caller API.
 */
type Counters = {
  views: number;   // user clicks into a lead
  shows: number;   // we displayed a lead
  hot: number;
  warm: number;
  cold: number;
};
const store: Record<string, Counters> = Object.create(null);

// ---- Demo/FOMO knobs (always return non-zero) ----
const FOMO_MIN = Number.parseInt(process.env.FOMO_MIN ?? "2", 10);   // hard floor
const FOMO_MAX = Number.parseInt(process.env.FOMO_MAX ?? "17", 10);  // soft cap

function seeded(host: string): number {
  // very small, fast, deterministic-ish hash -> [0,1)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1000) / 1000; // 0.000 .. 0.999
}

function dayWeight(now = new Date()): number {
  // business hours get more watchers; nights fewer (but never zero)
  const hr = now.getUTCHours(); // using UTC keeps containers consistent
  // 13..23 UTC ~= US daytime for many users; tweak as you like
  if (hr >= 13 && hr <= 23) return 1.0;
  if (hr >= 0 && hr <= 5)   return 0.45;
  return 0.7;
}

function demoWatchers(host: string, now = new Date()): number {
  const base = FOMO_MIN + (FOMO_MAX - FOMO_MIN) * seeded(host) * dayWeight(now);
  const jitter = Math.floor(seeded(host + now.getUTCHours()) * 3); // 0..2
  return Math.max(FOMO_MIN, Math.min(FOMO_MAX, Math.round(base) + jitter));
}

// ---- Public helpers you can call from other routes ----
export function recordLeadShown(host: string, temp: Temp) {
  const c = (store[host] ??= { views: 0, shows: 0, hot: 0, warm: 0, cold: 0 });
  c.shows++;
  c[temp]++;
}

export function recordLeadViewed(host: string) {
  const c = (store[host] ??= { views: 0, shows: 0, hot: 0, warm: 0, cold: 0 });
  c.views++;
}

export function getFomo(host: string) {
  // We combine the demo watchers with a whiff of real activity.
  const real = store[host]?.views ?? 0;
  return { watching: demoWatchers(host) + Math.min(5, real) };
}

export function getPublicMetrics() {
  let totalHosts = 0, shows = 0, views = 0, hot = 0, warm = 0, cold = 0;
  for (const k of Object.keys(store)) {
    totalHosts++;
    const c = store[k];
    shows += c.shows;
    views += c.views;
    hot += c.hot; warm += c.warm; cold += c.cold;
  }
  return { totalHosts, shows, views, hot, warm, cold };
}

// ---- Express router (mounted at /api/v1) ----
export const metricsRouter = Router();

/**
 * GET /api/v1/metrics/public
 * Quick sanity endpoint and tiny dashboard source.
 */
metricsRouter.get("/metrics/public", (_req: Request, res: Response) => {
  res.json({ ok: true, ...getPublicMetrics() });
});

/**
 * POST /api/v1/metrics/record
 * Body: { host: string, kind: "show"|"view", temp?: "hot"|"warm"|"cold" }
 */
metricsRouter.post("/metrics/record", (req: Request, res: Response) => {
  const { host, kind, temp } = req.body ?? {};
  if (!host || typeof host !== "string") {
    return res.status(400).json({ ok: false, error: "host required" });
  }
  if (kind === "show") {
    recordLeadShown(host, (temp as Temp) || "warm");
  } else if (kind === "view") {
    recordLeadViewed(host);
  } else {
    return res.status(400).json({ ok: false, error: "kind must be 'show' or 'view'" });
  }
  res.json({ ok: true, fomo: getFomo(host) });
});

// Optional: export a small facade for internal calls (no Express).
export const metrics = { recordLeadShown, recordLeadViewed, getFomo, getPublicMetrics };