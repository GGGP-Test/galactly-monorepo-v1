// src/utils/fsCache.ts
// Minimal in-memory cache with stable named exports.
// No imports from providers/types (avoids compile drift).

type Entry<T> = { v: T; t: number; ttl: number };

const mem = new Map<string, Entry<unknown>>();

export function makeKey(parts: Record<string, unknown>): string {
  return Object.keys(parts)
    .sort()
    .map(k => `${k}=${String((parts as any)[k] ?? "")}`)
    .join("&");
}

export function cacheGet<T>(key: string): T | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.ttl > 0 && Date.now() - e.t > e.ttl) {
    mem.delete(key);
    return undefined;
  }
  return e.v as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = 30 * 60_000): void {
  mem.set(key, { v: value, t: Date.now(), ttl: ttlMs });
}