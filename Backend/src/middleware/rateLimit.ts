import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Very small, dependency-free sliding window limiter.
 * Keys by API key header (if present) otherwise by client IP.
 * All envs are optional; sensible defaults are used.
 */

const WINDOW_MS = toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000); // 60s
const MAX_REQS  = toInt(process.env.RATE_LIMIT_MAX, 30);           // 30 reqs / window
const KEY_HDR   = (process.env.RATE_LIMIT_KEY_HEADER ?? "x-api-key").toLowerCase();

type Bucket = { remaining: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function toInt(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

/** Normalize various header shapes to a definite string. */
function headerToString(h: string | string[] | undefined): string | undefined {
  if (typeof h === "string") return h;
  if (Array.isArray(h) && h.length) return h[0]!;
  return undefined;
}

/** Pick a stable key for the caller (api key or ip), always a string. */
function clientKey(req: Request): string {
  // Prefer explicit API key if caller provides one.
  const apiKey = headerToString(req.headers[KEY_HDR]);
  if (apiKey && apiKey.trim().length) return apiKey.trim();

  // Else use first IP we can find.
  const xff = headerToString(req.headers["x-forwarded-for"]);
  const ipFromXff = xff ? xff.split(",")[0]!.trim() : undefined;

  const ip =
    ipFromXff ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    // @ts-expect-error: older node types
    (req.connection && (req.connection as any).remoteAddress) ||
    "unknown";

  return String(ip);
}

/** Periodic small cleanup so the Map doesn't grow forever. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}, Math.max(30_000, WINDOW_MS)).unref?.();

/** Default limiter middleware (global). */
const rateLimit: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  const key = clientKey(req); // <-- ALWAYS a string (fixes TS errors)

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { remaining: MAX_REQS, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }

  // If exhausted, reject
  if (b.remaining <= 0) {
    const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));

    res.setHeader("Retry-After", retrySec.toString());
    res.setHeader("X-RateLimit-Limit", String(MAX_REQS));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(Math.floor(b.resetAt / 1000)));
    res.status(429).json({
      error: "RATE_LIMITED",
      resetAt: new Date(b.resetAt).toISOString(),
      key
    });
    return;
  }

  // Spend a token and continue
  b.remaining -= 1;

  res.setHeader("X-RateLimit-Limit", String(MAX_REQS));
  res.setHeader("X-RateLimit-Remaining", String(b.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(b.resetAt / 1000)));

  next();
};

export default rateLimit;
export { rateLimit };