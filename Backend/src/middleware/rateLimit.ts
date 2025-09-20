import type { Request, Response, NextFunction } from "express";

/**
 * Tiny, dependency-free token-bucket rate limiter.
 * Defaults can be overridden via env or options.
 *
 * Env (optional):
 *   RL_WINDOW_MS   – window size in ms (default 60000)
 *   RL_MAX         – sustained requests per window (default 30)
 *   RL_BURST       – extra burst capacity above RL_MAX (default 10)
 */
export type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  burst?: number;
  key?: (req: Request) => string | undefined; // return custom key; fallback to X-Api-Key or IP
};

type Bucket = { tokens: number; last: number };

export default function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs =
    Math.max(
      1000,
      Number.isFinite(opts.windowMs) ? Number(opts.windowMs) : Number(process.env.RL_WINDOW_MS) || 60_000
    );

  const max =
    Math.max(1, Number.isFinite(opts.max) ? Number(opts.max) : Number(process.env.RL_MAX) || 30);

  const burst =
    Math.max(0, Number.isFinite(opts.burst) ? Number(opts.burst) : Number(process.env.RL_BURST) || 10);

  const capacity = max + burst;                 // maximum tokens a bucket can hold
  const ratePerMs = max / windowMs;             // refill speed

  const buckets = new Map<string, Bucket>();

  const handler = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();

    // Build a stable key: custom -> header -> IP
    const custom = typeof opts.key === "function" ? opts.key(req) : undefined;
    const fromHeader = (req.headers["x-api-key"] as string | undefined) ?? undefined;
    const key = (custom && custom.trim()) || (fromHeader && fromHeader.trim()) || req.ip;

    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, last: now };
      buckets.set(key, b);
    }

    // Refill tokens
    const elapsed = now - b.last;
    b.tokens = Math.min(capacity, b.tokens + elapsed * ratePerMs);
    b.last = now;

    // Enough budget?
    if (b.tokens >= 1) {
      b.tokens -= 1;
      res.setHeader("X-RateLimit-Limit", String(capacity));
      res.setHeader("X-RateLimit-Remaining", String(Math.floor(b.tokens)));
      return next();
    }

    // Too many requests
    const deficit = 1 - b.tokens;
    const msUntilOneToken = Math.ceil(deficit / ratePerMs);
    res.setHeader("Retry-After", String(Math.ceil(msUntilOneToken / 1000)));
    res.setHeader("X-RateLimit-Limit", String(capacity));
    res.setHeader("X-RateLimit-Remaining", "0");
    return res.status(429).json({
      error: "RATE_LIMITED",
      retryAfterMs: msUntilOneToken
    });
  };

  return handler;
}