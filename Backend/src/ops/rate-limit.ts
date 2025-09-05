// src/ops/rate-limit.ts
/**
 * Simple rate limiters: TokenBucket + SlidingWindow + Express-style middleware.
 * In-memory by default; pluggable backing store interface for Redis if needed.
 */

import { telemetry } from "./telemetry";

export interface RateLimitDecision {
  allow: boolean;
  retryAfterSec?: number;
  tokensLeft?: number;
}

export interface BucketConfig {
  capacity: number; // max tokens
  refillPerSec: number; // tokens per second
}

export interface SlidingConfig {
  windowSec: number;
  maxInWindow: number;
}

export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  incr(key: string, ttlSec?: number): Promise<number>;
  ttl(key: string): Promise<number | null>;
  del(key: string): Promise<void>;
}

class MemoryKv implements Kv {
  private map = new Map<string, { v: string; exp?: number }>();
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) {
      this.map.delete(key);
      return null;
    }
    return e.v;
  }
  async set(key: string, value: string, ttlSec?: number) {
    this.map.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
  }
  async incr(key: string, ttlSec?: number) {
    const cur = Number((await this.get(key)) || "0");
    const n = cur + 1;
    await this.set(key, String(n), ttlSec);
    return n;
  }
  async ttl(key: string) {
    const e = this.map.get(key);
    if (!e || !e.exp) return null;
    const rem = Math.max(0, Math.floor((e.exp - Date.now()) / 1000));
    return rem;
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

export class TokenBucketLimiter {
  constructor(private kv: Kv = new MemoryKv()) {}
  async decide(key: string, cfg: BucketConfig): Promise<RateLimitDecision> {
    const bucketKey = `rl:tb:${key}`;
    const now = Date.now();

    const raw = (await this.kv.get(bucketKey)) || JSON.stringify({ tokens: cfg.capacity, ts: now });
    let state = JSON.parse(raw) as { tokens: number; ts: number };

    // refill
    const elapsed = Math.max(0, now - state.ts) / 1000;
    state.tokens = Math.min(cfg.capacity, state.tokens + elapsed * cfg.refillPerSec);
    state.ts = now;

    // consume
    if (state.tokens >= 1) {
      state.tokens -= 1;
      await this.kv.set(bucketKey, JSON.stringify(state), Math.ceil(cfg.capacity / cfg.refillPerSec) + 2);
      telemetry.counter("rate_allow_total", { help: "Allowed requests", labelNames: ["policy"] }).inc(1, { policy: "tb" });
      return { allow: true, tokensLeft: Math.floor(state.tokens) };
    } else {
      const need = 1 - state.tokens;
      const retryAfterSec = Math.ceil(need / cfg.refillPerSec);
      await this.kv.set(bucketKey, JSON.stringify(state), Math.ceil(cfg.capacity / cfg.refillPerSec) + 2);
      telemetry.counter("rate_block_total", { help: "Blocked requests", labelNames: ["policy"] }).inc(1, { policy: "tb" });
      return { allow: false, retryAfterSec, tokensLeft: 0 };
    }
  }
}

export class SlidingWindowLimiter {
  constructor(private kv: Kv = new MemoryKv()) {}
  async decide(key: string, cfg: SlidingConfig): Promise[RateLimitDecision] {
    const windowKey = `rl:sw:${key}`;
    const count = await this.kv.incr(windowKey, cfg.windowSec);
    if (count <= cfg.maxInWindow) {
      telemetry.counter("rate_allow_total", { labelNames: ["policy"] }).inc(1, { policy: "sw" });
      return { allow: true, tokensLeft: cfg.maxInWindow - count };
    }
    const ttl = (await this.kv.ttl(windowKey)) ?? cfg.windowSec;
    telemetry.counter("rate_block_total", { labelNames: ["policy"] }).inc(1, { policy: "sw" });
    return { allow: false, retryAfterSec: ttl, tokensLeft: 0 };
  }
}

// Policy wrapper
export type Plan = "free" | "pro";
export interface Policy {
  name: string; // human readable
  when: (ctx: { path: string; method: string; userId?: string; tenantId?: string; plan: Plan }) => boolean;
  decide: (key: string) => Promise<RateLimitDecision>;
}

export class RateLimiter {
  constructor(private policies: Policy[]) {}
  async check(ctx: { path: string; method: string; userId?: string; tenantId?: string; plan: Plan }) {
    for (const p of this.policies) {
      if (p.when(ctx)) {
        const key = `${ctx.tenantId || "anon"}:${ctx.userId || "anon"}:${p.name}`;
        return p.decide(key);
      }
    }
    return { allow: true } as RateLimitDecision;
  }
  // Express-style middleware (no external types)
  middleware() {
    return async (req: any, res: any, next: any) => {
      const ctx = {
        path: req.path || req.url || "",
        method: (req.method || "GET").toUpperCase(),
        userId: req.user?.id || req.headers["x-user-id"],
        tenantId: req.headers["x-tenant-id"] || req.user?.tenantId,
        plan: (req.user?.plan || req.headers["x-plan"] || "free") as Plan,
      };
      const decision = await this.check(ctx);
      res.setHeader?.("x-rate-remaining", String(decision.tokensLeft ?? ""));
      if (!decision.allow) {
        if (decision.retryAfterSec) res.setHeader?.("retry-after", String(decision.retryAfterSec));
        res.status?.(429).json?.({ error: "rate_limited", retryAfterSec: decision.retryAfterSec });
        return;
      }
      next?.();
    };
  }
}

// Default instance with sensible policies
const tb = new TokenBucketLimiter();
const sw = new SlidingWindowLimiter();

export const defaultRateLimiter = new RateLimiter([
  {
    name: "pipeline:run:free",
    when: (c) => c.path.startsWith("/api/pipeline/run") && c.plan === "free",
    decide: (key) => tb.decide(key, { capacity: 5, refillPerSec: 1 / 60 }), // 5 requests, ~1/min
  },
  {
    name: "pipeline:run:pro",
    when: (c) => c.path.startsWith("/api/pipeline/run") && c.plan === "pro",
    decide: (key) => tb.decide(key, { capacity: 30, refillPerSec: 1 / 5 }), // 30 requests, 1/5s
  },
  {
    name: "contacts:resolve",
    when: (c) => c.path.includes("/contacts") && c.method === "POST",
    decide: (key) => sw.decide(key, { windowSec: 60, maxInWindow: 60 }), // 60/min
  },
]);
