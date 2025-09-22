import { Router, Request, Response } from "express";
import crypto from "crypto";

/**
 * Router: /api/v1/metrics
 *
 * Endpoints
 *   POST  /lead-shown      -> record that we displayed a lead row
 *   POST  /lead-viewed     -> record that a lead row was opened
 *   GET   /fomo?host=...   -> non-zero viewer count (demo-friendly)
 *   GET   /public          -> small, sanitized counters used by the UI
 *
 * Notes
 * - Everything is in-memory and safe for free/demo usage.
 * - No imports from lib/ or services/ (you removed those dirs).
 * - We export a *named* `metrics` to match `import { metrics } from "./routes/metrics"`.
 */

type Temp = "hot" | "warm" | "cold";

interface Counter {
  shown: number;
  viewed: number;
  last: number; // epoch ms
}

const leadCounters = new Map<string, Counter>();

function upsertCounter(host: string): Counter {
  const now = Date.now();
  const c = leadCounters.get(host);
  if (c) {
    c.last = now;
    return c;
  }
  const created: Counter = { shown: 0, viewed: 0, last: now };
  leadCounters.set(host, created);
  return created;
}

/**
 * Stable-ish, non-zero watcher count for FOMO.
 * - Time-of-day bumps (day > night)
 * - Host-seeded jitter so the number isn't identical across hosts
 * - Always >= 1 (you asked to never show zero)
 */
function fomoWatchers(host: string, now = new Date()): number {
  // 0..23
  const hour = now.getUTCHours();

  // base: nights (0-6, 20-23) low; daytime higher
  const base =
    hour >= 7 && hour <= 19
      ? 18 // daytime baseline
      : 6; // night baseline

  // host-seeded 0..12 jitter
  const hash = crypto.createHash("sha1").update(host).digest();
  const seed = hash[0] % 13; // 0..12

  // minute wobble (keeps it moving a little)
  const wobble = Math.floor((now.getUTCMinutes() % 10) / 2); // 0..4

  const n = base + seed + wobble;

  // Always at least 1, cap to something reasonable for UI
  return Math.max(1, Math.min(n, 64));
}

export const metrics = Router();

/**
 * POST /api/v1/metrics/lead-shown
 * body: { host: string; temp?: "hot" | "warm" | "cold" }
 */
metrics.post("/lead-shown", (req: Request, res: Response) => {
  const { host, temp } = req.body as { host?: string; temp?: Temp };
  if (!host || typeof host !== "string") {
    return res.status(400).json({ ok: false, error: "host is required" });
  }
  upsertCounter(host).shown += 1;

  // We don’t persist temp, but we could tally by temp later if you want.
  return res.json({ ok: true, host, temp: temp ?? "warm" });
});

/**
 * POST /api/v1/metrics/lead-viewed
 * body: { host: string }
 */
metrics.post("/lead-viewed", (req: Request, res: Response) => {
  const { host } = req.body as { host?: string };
  if (!host || typeof host !== "string") {
    return res.status(400).json({ ok: false, error: "host is required" });
  }
  upsertCounter(host).viewed += 1;
  return res.json({ ok: true, host });
});

/**
 * GET /api/v1/metrics/fomo?host=peekpackaging.com
 * Returns a non-zero watcher count for the little “watching now” pill.
 */
metrics.get("/fomo", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) {
    return res.status(400).json({ ok: false, error: "host query is required" });
  }
  const watching = fomoWatchers(host);
  return res.json({ ok: true, watching });
});

/**
 * GET /api/v1/metrics/public
 * Very small, sanitized snapshot to power any tiny UI badges.
 */
metrics.get("/public", (_req: Request, res: Response) => {
  const now = Date.now();
  // summarize only recent things (last 24h) to avoid unbounded growth feel
  const DAY = 24 * 60 * 60 * 1000;
  const recent: Record<string, { shown: number; viewed: number }> = {};
  for (const [host, c] of leadCounters.entries()) {
    if (now - c.last <= DAY) {
      recent[host] = { shown: c.shown, viewed: c.viewed };
    }
  }
  res.json({ ok: true, recent });
});

// Optional default export, harmless if unused
export default metrics;