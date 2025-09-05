// src/security/rate-limit.ts
/**
 * Simple sliding-window rate limiter (in-memory) with per-key quotas.
 * Optional burst cost: consume(key, cost)
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number; // ms until window reset
}

export interface RateLimiterInit {
  windowMs: number; // e.g. 60_000
  max: number;      // e.g. 120 requests / window
}

export class RateLimiter {
  private windowMs: number;
  private max: number;
  private buckets = new Map<string, number[]>(); // key -> timestamps (ms)

  constructor(init: RateLimiterInit) {
    this.windowMs = init.windowMs;
    this.max = init.max;
  }

  /** Attempt to consume N tokens (default 1). */
  consume(key: string, cost = 1): RateLimitResult {
    const now = Date.now();
    const start = now - this.windowMs;
    const arr = (this.buckets.get(key) || []).filter((ts) => ts > start);
    const used = arr.length;
    const allowed = used + cost <= this.max;
    if (allowed) {
      for (let i = 0; i < cost; i++) arr.push(now);
      this.buckets.set(key, arr);
    }
    const nextReset = arr.length ? this.windowMs - (now - arr[0]) : this.windowMs;
    return {
      allowed,
      remaining: Math.max(0, this.max - (allowed ? used + cost : used)),
      resetMs: Math.max(0, nextReset),
    };
  }

  /** Peek without consuming. */
  peek(key: string): RateLimitResult {
    const now = Date.now();
    const start = now - this.windowMs;
    const arr = (this.buckets.get(key) || []).filter((ts) => ts > start);
    const used = arr.length;
    const nextReset = arr.length ? this.windowMs - (now - arr[0]) : this.windowMs;
    return { allowed: used < this.max, remaining: Math.max(0, this.max - used), resetMs: Math.max(0, nextReset) };
  }

  /** Reset a key bucket (e.g., admin override). */
  reset(key: string) {
    this.buckets.delete(key);
  }
}
