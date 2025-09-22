import { Router, Request, Response } from "express";

export type Temp = "hot" | "warm" | "cold";

type Counters = {
  views: number;   // user clicked/opened a lead
  shows: number;   // we displayed a lead
  hot: number;
  warm: number;
  cold: number;
};

const store: Record<string, Counters> = Object.create(null);

// ---- FOMO knobs (never show 0) ----
const FOMO_MIN = Number.parseInt(process.env.FOMO_MIN ?? "2", 10);   // hard floor
const FOMO_MAX = Number.parseInt(process.env.FOMO_MAX ?? "17", 10);  // soft cap

function seeded(host: string): number {
  // tiny fast hash -> [0,1)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1000) / 1000;
}

function dayWeight(now = new Date()): number {
  // daytime heavier; nights lighter (but non-zero)
  const hr = now.getUTCHours();
  if (hr >= 13 && hr <= 23) return 1.0;   // US daytime-ish
  if (hr >= 0 && hr <= 5)   return 0.45;  // deep night
  return 0.7;                              // shoulder hours
}

function demoWatchers(host: string, now = new Date()): number {
  const base = FOMO_MIN + (FOMO_MAX - FOMO_MIN) * seeded(host) * dayWeight(now);
  const jitter = Math.floor(seeded(host + now.getUTCHours()) * 3); // 0..2
  return Math.max(FOMO_MIN, Math.min(FOMO_MAX, Math.round(base) + jitter));
}

// ---- Public helpers for other routes ----
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

// ---- Express router (mounted under /api/v1) ----
export const metricsRouter = Router();

/**
 * GET /api/v1/metrics/public
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

// Small facade for internal callers.
export const metrics = { recordLeadShown, recordLeadViewed, getFomo, getPublicMetrics };