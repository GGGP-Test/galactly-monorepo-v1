// src/middleware/ratelimit.ts
import type { RequestHandler } from "express";

type Options = {
  /** window in ms */
  windowMs?: number;
  /** max requests per window */
  max?: number;
  /** which header to use as key (fallbacks to ip) */
  keyHeader?: string;
};

type Bucket = { count: number; resetAt: number };

// Simple in-memory fixed-window limiter.
// No external deps. Good enough for admin tools / demos.
export function buyersRateLimit(opts: Options = {}): RequestHandler {
  const windowMs =
    typeof opts.windowMs === "number" && Number.isFinite(opts.windowMs)
      ? opts.windowMs
      : Number(process.env.RATE_WINDOW_MS ?? 15 * 60 * 1000);

  const max =
    typeof opts.max === "number" && Number.isFinite(opts.max)
      ? opts.max
      : Number(process.env.RATE_MAX ?? 60);

  const keyHeader = String(
    (opts.keyHeader ?? process.env.RATE_KEY_HEADER ?? "x-api-key")
  ).toLowerCase();

  const buckets = new Map<string, Bucket>();

  return (req, res, next) => {
    const now = Date.now();

    // Always return a STRING key (no undefined)
    const headerVal = req.get(keyHeader);
    const key = headerVal ?? req.ip ?? "anon";

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }

    b.count += 1;

    // Standard rate-limit headers
    const remaining = Math.max(0, max - b.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(b.resetAt / 1000)));

    if (b.count > max) {
      const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res
        .status(429)
        .json({ error: "RATE_LIMIT", retryAfterSec, ok: false });
    }

    next();
  };
}

export default buyersRateLimit;