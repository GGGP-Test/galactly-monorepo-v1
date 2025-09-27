// Small, dependency-free helpers to protect external calls and cache results.
// Exports:
//  - TTLCache & withCache(): in-memory TTL cache
//  - DailyCounter (singleton "daily"): per-key daily caps (resets at UTC day)
//  - RateGate (singleton "rate"): simple per-window rate limiter

/* eslint-disable @typescript-eslint/no-explicit-any */

export class TTLCache<K, V> {
  private store = new Map<K, { v: V; exp: number }>();
  private _max: number;

  constructor(maxItems = 1000) {
    this._max = Math.max(10, maxItems);
  }

  get(key: K, now = Date.now()): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.exp <= now) {
      this.store.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: K, val: V, ttlMs: number, now = Date.now()): void {
    const exp = now + Math.max(1, ttlMs);
    this.store.set(key, { v: val, exp });
    // very simple pruning
    if (this.store.size > this._max) {
      for (const k of this.store.keys()) {
        const rec = this.store.get(k);
        if (!rec || rec.exp <= now) this.store.delete(k);
        if (this.store.size <= this._max) break;
      }
    }
  }

  has(key: K, now = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const cache = new TTLCache<string, unknown>(1000);

// Helper: wrap an async producer with cache
export async function withCache<V>(
  key: string,
  ttlMs: number,
  producer: () => Promise<V> | V,
): Promise<V> {
  const hit = cache.get(key) as V | undefined;
  if (hit !== undefined) return hit;
  const val = await producer();
  cache.set(key, val as unknown, ttlMs);
  return val;
}

// ---- Daily caps -------------------------------------------------------------

type DayBucket = { day: string; count: number };

export class DailyCounter {
  private map = new Map<string, DayBucket>();

  private today(now = new Date()): string {
    // UTC day bucket YYYY-MM-DD
    return now.toISOString().slice(0, 10);
  }

  get(key: string, now = new Date()): number {
    const b = this.map.get(key);
    const d = this.today(now);
    if (!b || b.day !== d) return 0;
    return b.count;
  }

  inc(key: string, n = 1, now = new Date()): number {
    const d = this.today(now);
    const b = this.map.get(key);
    if (!b || b.day !== d) {
      const nb: DayBucket = { day: d, count: Math.max(0, n) };
      this.map.set(key, nb);
      return nb.count;
    }
    b.count += Math.max(0, n);
    return b.count;
  }

  allow(key: string, limit: number, now = new Date()): { ok: boolean; remaining: number } {
    const used = this.get(key, now);
    const remaining = Math.max(0, limit - used);
    if (remaining <= 0) return { ok: false, remaining: 0 };
    this.inc(key, 1, now);
    return { ok: true, remaining: remaining - 1 };
  }
}

export const daily = new DailyCounter();

// ---- Simple rate gate (fixed window) ---------------------------------------

export class RateGate {
  private buckets = new Map<string, { start: number; count: number }>();

  // e.g. allow 5 per 10_000ms
  allow(key: string, maxPerWindow: number, windowMs: number, now = Date.now()): {
    ok: boolean;
    remaining: number;
    resetInMs: number;
  } {
    const w = Math.max(1, windowMs);
    const start = Math.floor(now / w) * w;
    const b = this.buckets.get(key);
    if (!b || b.start !== start) {
      this.buckets.set(key, { start, count: 1 });
      return { ok: true, remaining: Math.max(0, maxPerWindow - 1), resetInMs: start + w - now };
    }
    if (b.count >= maxPerWindow) {
      return { ok: false, remaining: 0, resetInMs: b.start + w - now };
    }
    b.count += 1;
    return { ok: true, remaining: Math.max(0, maxPerWindow - b.count), resetInMs: b.start + w - now };
  }
}

export const rate = new RateGate();
