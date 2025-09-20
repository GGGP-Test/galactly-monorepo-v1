// src/middleware/rateLimit.ts
import { Request, Response, NextFunction } from "express";

type Options = {
  windowMs: number;      // e.g. 60_000
  max: number;           // e.g. 120 requests per window
  key?: (req: Request) => string; // how to identify a client
};

type Bucket = { count: number; resetAt: number };

export default function rateLimit(opts: Options) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key =
      (opts.key ? opts.key(req) : undefined) ||
      req.get("x-api-key") ||
      req.ip;

    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }

    if (b.count >= opts.max) {
      const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-Rate-Limit-Limit", String(opts.max));
      res.setHeader("X-Rate-Limit-Remaining", "0");
      res.setHeader("X-Rate-Limit-Reset", String(Math.floor(b.resetAt / 1000)));
      return res
        .status(429)
        .json({ error: "RATE_LIMITED", retryAfterSec });
    }

    b.count += 1;
    res.setHeader("X-Rate-Limit-Limit", String(opts.max));
    res.setHeader(
      "X-Rate-Limit-Remaining",
      String(Math.max(0, opts.max - b.count))
    );
    res.setHeader("X-Rate-Limit-Reset", String(Math.floor(b.resetAt / 1000)));

    next();
  };
}