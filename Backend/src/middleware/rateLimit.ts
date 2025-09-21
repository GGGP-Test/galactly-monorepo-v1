// src/middleware/rateLimit.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

type RateLimitOptions = {
  /** window size in ms (default 10s) */
  windowMs?: number;
  /** max requests per window per key (default 8) */
  max?: number;
  /** custom key function; default: X-Api-Key -> ip -> "anon" */
  key?: (req: Request) => string;
  /** inject time source for tests */
  now?: () => number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export default function rateLimit(opts: RateLimitOptions = {}): RequestHandler {
  const windowMs = Math.max(1, opts.windowMs ?? 10_000);
  const max = Math.max(1, opts.max ?? 8);
  const nowFn = opts.now ?? Date.now;
  const keyFn =
    opts.key ??
    ((req: Request) => {
      const apiKey = (req.header("x-api-key") ?? "").trim();
      // scope the bucket by route so different endpoints don't fight each other
      const route = req.baseUrl + req.path; // e.g. /api/v1/leads/find-buyers
      const who = apiKey || req.ip || "anon";
      return `${who}:${route}`;
    });

  const handler: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = nowFn();

    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }

    // set informational headers on every response
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - b.count - 1)));
    res.setHeader("X-RateLimit-Reset", String(b.resetAt));

    if (b.count >= max) {
      const retryAfterMs = b.resetAt - now;
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ ok: false, error: "RATE_LIMIT", retryAfterMs });
      return;
    }

    b.count += 1;
    next();
  };

  return handler;
}

// Optional helpers you may want later
export function _rateLimitBucketsSize(): number {
  return buckets.size;
}
export function _rateLimitClear(): void {
  buckets.clear();
}