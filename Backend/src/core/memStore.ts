// src/core/memStore.ts
/**
 * A tiny, dependency-free in-memory store with TTL + LRU eviction.
 * - Generic over value type V
 * - Keys are strings (so snapshots are JSON-serializable)
 * - Async getOrCreate with in-flight de-duplication
 * - Stats + snapshot/restore hooks (no Node types/imports)
 */

export type EvictReason = 'max' | 'expired' | 'manual';

export interface MemStoreOptions<V> {
  /** Default TTL for new entries (ms). 0/undefined = never expire. */
  ttlMs?: number;
  /** Maximum number of entries before LRU eviction. 0/undefined = unbounded. */
  max?: number;
  /** Called when an entry is evicted. */
  onEvict?: (key: string, value: V, reason: EvictReason) => void;
}

export interface Entry<V> {
  value: V;
  /** absolute epoch ms when this entry expires (Number.MAX_SAFE_INTEGER = no expiry) */
  exp: number;
  created: number;
  hits: number;
}

export interface StoreStats {
  size: number;
  max: number | undefined;
  defaultTtlMs: number | undefined;
  hits: number;
  misses: number;
  evicted: number;
  expired: number;
}

/** JSON-serializable snapshot */
export type Snapshot<V> = Array<[string, Entry<V>]>;

export class MemStore<V> {
  private map = new Map<string, Entry<V>>(); // preserves insertion order (LRU)
  private inflight = new Map<string, Promise<V>>();
  private opts: MemStoreOptions<V>;
  private stats: StoreStats = {
    size: 0,
    max: undefined,
    defaultTtlMs: undefined,
    hits: 0,
    misses: 0,
    evicted: 0,
    expired: 0,
  };

  constructor(options: MemStoreOptions<V> = {}) {
    this.opts = options;
    this.stats.max = options.max;
    this.stats.defaultTtlMs = options.ttlMs;
  }

  /** Number of items currently stored (after pruning). */
  get size() {
    this.pruneExpired();
    return this.map.size;
  }

  /** Returns current stats. */
  getStats(): StoreStats {
    this.pruneExpired();
    return { ...this.stats, size: this.map.size };
  }

  /** Get value if present and not expired; bumps LRU. */
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.stats.misses++;
      return undefined;
    }
    if (e.exp <= Date.now()) {
      this.map.delete(key);
      this.stats.expired++;
      this.stats.misses++;
      this.opts.onEvict?.(key, e.value, 'expired');
      return undefined;
    }
    // bump LRU by re-inserting
    this.map.delete(key);
    this.map.set(key, { ...e, hits: e.hits + 1 });
    this.stats.hits++;
    return e.value;
  }

  /** Set/replace a value with optional per-entry TTL. */
  set(key: string, value: V, ttlMs?: number) {
    const exp =
      ttlMs == null
        ? this.expFromDefault()
        : ttlMs <= 0
        ? Number.MAX_SAFE_INTEGER
        : Date.now() + ttlMs;

    const entry: Entry<V> = {
      value,
      exp,
      created: Date.now(),
      hits: 0,
    };
    // insert new (LRU tail)
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);

    this.enforceMax();
  }

  /** Delete a key if present. */
  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.opts.onEvict?.(key, e.value, 'manual');
    return true;
  }

  /** Clear everything. */
  clear() {
    if (this.opts.onEvict) {
      for (const [k, e] of this.map) this.opts.onEvict(k, e.value, 'manual');
    }
    this.map.clear();
  }

  /** Get if present, otherwise create via async factory (with in-flight de-dupe). */
  async getOrCreate(
    key: string,
    factory: () => Promise<V> | V,
    ttlMs?: number
  ): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    let p = this.inflight.get(key);
    if (!p) {
      const maybePromise = factory();
      p = Promise.resolve(maybePromise);
      this.inflight.set(key, p);
      p.finally(() => this.inflight.delete(key));
    }
    const value = await p;
    this.set(key, value, ttlMs);
    return value;
  }

  /** Snapshot for persistence (JSON-serializable). */
  snapshot(): Snapshot<V> {
    this.pruneExpired();
    return Array.from(this.map.entries());
  }

  /** Restore from a snapshot (replaces existing content). */
  restore(snap: Snapshot<V>) {
    this.map.clear();
    for (const [k, e] of snap) {
      // Skip already-expired entries
      if (e.exp > Date.now()) this.map.set(k, e);
    }
  }

  /** Iterate keys (after pruning) */
  *keys(): IterableIterator<string> {
    this.pruneExpired();
    yield* this.map.keys();
  }

  /** Iterate values (after pruning) */
  *values(): IterableIterator<V> {
    this.pruneExpired();
    for (const e of this.map.values()) yield e.value;
  }

  /** Iterate entries (after pruning) */
  *entries(): IterableIterator<[string, V]> {
    this.pruneExpired();
    for (const [k, e] of this.map) yield [k, e.value];
  }

  // ---- internal helpers ----
  private expFromDefault(): number {
    const d = this.opts.ttlMs;
    if (d == null || d <= 0) return Number.MAX_SAFE_INTEGER;
    return Date.now() + d;
    }

  private pruneExpired() {
    const now = Date.now();
    if (this.map.size === 0) return;
    for (const [k, e] of this.map) {
      if (e.exp <= now) {
        this.map.delete(k);
        this.stats.expired++;
        this.opts.onEvict?.(k, e.value, 'expired');
      }
    }
  }

  private enforceMax() {
    const max = this.opts.max ?? 0;
    if (max <= 0) return;
    // evict from LRU head while over capacity
    while (this.map.size > max) {
      const first = this.map.keys().next().value as string | undefined;
      if (first === undefined) break;
      const e = this.map.get(first)!;
      this.map.delete(first);
      this.stats.evicted++;
      this.opts.onEvict?.(first, e.value, 'max');
    }
  }
}

export default MemStore;

/* -------- Usage notes (no runtime effect) --------
import MemStore from '../core/memStore';

type Lead = { host:string; platform:'web'; title:string; created:string; temp:'hot'|'warm'|'cold'; whyText:string };

const store = new MemStore<Lead>({ ttlMs: 15*60_000, max: 1000 });
const key = `${host}|${region}|${radius}`;
const lead = await store.getOrCreate(key, async () => computeLead(host, region, radius));
*/