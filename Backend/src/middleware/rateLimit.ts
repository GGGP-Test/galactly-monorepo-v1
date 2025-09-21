// src/middleware/rateLimit.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";

export type RateLimitOptions = {
  /** time window in ms */
  windowMs?: number;
  /** max requests per key within the window */
  max?: number;
  /** derive the key (ip+route by default) */
  key?: (req: Request) => string;
  /** set X-RateLimit-* headers */
  headers?: boolean;
};

// tiny in-memory store (per process)
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

function defaultKey(req: Request): string {
  // prefer x-forwarded-for if present (behind proxies), else ip/remoteAddress
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = fwd ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
  return `${ip}:${req.method}:${req.path}`;
}

/**
 * Express-compatible rate limit middleware (no deps).
 * Returns a RequestHandler so `app.get(..., rl, ...)` type-checks.
 */
export default function rateLimit(opts: RateLimitOptions = {}): RequestHandler {
  const windowMs = opts.windowMs ?? 10_000;
  const max = opts.max ?? 8;
  const keyFn = opts.key ?? defaultKey;
  const sendHeaders = opts.headers ?? true;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = keyFn(req);

    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(key, bucket);
    }

    bucket.count += 1;

    // headers must be strings – never pass undefined
    if (sendHeaders) {
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
      // epoch seconds to match common convention
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    }

    if (bucket.count > max) {
      const retryAfterMs = Math.max(0, bucket.resetAt - now);
      // optional standard headers (also strings)
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ ok: false, error: "RATE_LIMIT", retryAfterMs });
      return;
    }

    next();
  };
}