// src/utils/fsCache.ts
// Lightweight in-memory TTL cache.
// No imports. Works with both named and default imports.

type Entry<T> = { v: T; t: number; ttl: number };

const mem = new Map<string, Entry<unknown>>();

/** Build a stable cache key from a record (sorted keys). */
export function makeKey(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  let out = "";
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const v = parts[k];
    out += (i ? "&" : "") + k + "=" + String(v ?? "");
  }
  return out;
}

/** Read from cache; respects TTL expiry. */
export function cacheGet<T>(key: string): T | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.ttl > 0 && Date.now() - e.t > e.ttl) {
    mem.delete(key);
    return undefined;
  }
  return e.v as T;
}

/** Write to cache with TTL (default 30 minutes). */
export function cacheSet<T>(key: string, value: T, ttlMs: number = 30 * 60000): void {
  mem.set(key, { v: value, t: Date.now(), ttl: ttlMs });
}

/** Optional: clear a single key (used by tests or reindex). */
export function cacheDel(key: string): void {
  mem.delete(key);
}

/** Optional: clear everything. */
export function cacheClear(): void {
  mem.clear();
}

// Support default import patterns:  import cache from '../utils/fsCache'
const defaultExport = { makeKey, cacheGet, cacheSet, cacheDel, cacheClear };
export default defaultExport;