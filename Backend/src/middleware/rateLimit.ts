// src/middleware/rateLimit.ts
import { Request, Response, NextFunction } from "express";

type Options = {
  /** time window in milliseconds */
  windowMs?: number;
  /** max requests allowed within window per key (IP) */
  max?: number;
  /** metrics key prefix */
  keyPrefix?: string;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff ?? req.socket.remoteAddress ?? "unknown";
}

export default function rateLimit(opts: Options = {}) {
  const windowMs = Number(process.env.RATE_WINDOW_MS ?? opts.windowMs ?? 10_000);
  const max = Number(process.env.RATE_MAX ?? opts.max ?? 8);
  const keyPrefix = opts.keyPrefix ?? "rl";

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${clientIp(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      const retryMs = bucket.resetAt - now;
      res.setHeader("Retry-After", String(Math.ceil(retryMs / 1000)));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
      return res.status(429).json({ error: "RATE_LIMITED", retryMs });
    }

    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max - bucket.count));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    next();
  };
}