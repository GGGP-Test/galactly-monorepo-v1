/**
 * Lightweight in-memory “bleed” (debug/telemetry) store.
 * - No top-level await, no filesystem, no network.
 * - Designed to NEVER throw; all methods are safe no-ops when disabled.
 * - Ring buffer to avoid unbounded memory growth.
 *
 * Typical usage elsewhere:
 *   import bleed, { bleedFor } from "../data/bleed-store";
 *   bleed.info("buyers", "starting discovery", { supplier, region });
 *   const b = bleedFor("buyers"); b.debug("step", "parsed page", { url });
 */

export type BleedLevel = "debug" | "info" | "warn" | "error";

export interface BleedEvent<T = unknown> {
  t: number;               // epoch ms
  ns: string;              // namespace (e.g. "buyers")
  level: BleedLevel;
  msg: string;
  data?: T;                // arbitrary payload
}

export interface BleedStoreOptions {
  max?: number;            // ring buffer size
  enabled?: boolean;       // default on/off
}

class BleedStore {
  private buf: BleedEvent[] = [];
  private head = 0;
  private _size = 0;
  private readonly max: number;
  private _enabled: boolean;

  constructor(opts: BleedStoreOptions = {}) {
    this.max = Math.max(50, Math.floor(opts.max ?? 2000));
    this._enabled = opts.enabled ?? true;
  }

  /** enable/disable logging */
  enable(on = true): void { this._enabled = !!on; }
  disable(): void { this._enabled = false; }
  get enabled(): boolean { return this._enabled; }

  /** number of events retained */
  get size(): number { return this._size; }
  /** capacity of the ring buffer */
  get capacity(): number { return this.max; }

  /** push a prebuilt event (used internally) */
  push(ev: BleedEvent): void {
    if (!this._enabled) return;
    if (this._size < this.max) {
      this.buf[this._size++] = ev;
    } else {
      this.buf[this.head] = ev;
      this.head = (this.head + 1) % this.max;
    }
  }

  /** generic log */
  log<T = unknown>(ns: string, level: BleedLevel, msg: string, data?: T): void {
    this.push({ t: Date.now(), ns, level, msg, data });
  }

  debug<T = unknown>(ns: string, msg: string, data?: T): void { this.log(ns, "debug", msg, data); }
  info<T = unknown>(ns: string, msg: string, data?: T): void  { this.log(ns, "info",  msg, data); }
  warn<T = unknown>(ns: string, msg: string, data?: T): void  { this.log(ns, "warn",  msg, data); }
  error<T = unknown>(ns: string, msg: string, data?: T): void { this.log(ns, "error", msg, data); }

  /** get all events (optionally filtered) in chronological order */
  all(filter?: { ns?: string; level?: BleedLevel }): BleedEvent[] {
    const out: BleedEvent[] = [];
    if (this._size === 0) return out;

    // reconstruct chronology from ring buffer
    const start = this._size === this.max ? this.head : 0;
    for (let i = 0; i < this._size; i++) {
      const idx = (start + i) % this.max;
      const ev = this.buf[idx];
      if (!ev) continue;

      if (filter?.ns && ev.ns !== filter.ns) continue;
      if (filter?.level && ev.level !== filter.level) continue;
      out.push(ev);
    }
    return out;
  }

  /** last N events (default 100) */
  tail(n = 100, filter?: { ns?: string; level?: BleedLevel }): BleedEvent[] {
    const all = this.all(filter);
    return all.slice(Math.max(0, all.length - n));
  }

  /** remove all retained events */
  clear(): void {
    this.buf = [];
    this.head = 0;
    this._size = 0;
  }

  /** minimal status snapshot (handy for /healthz) */
  status(): { enabled: boolean; size: number; capacity: number } {
    return { enabled: this._enabled, size: this._size, capacity: this.max };
  }
}

/**
 * Multiple named stores (so features can keep their own logs):
 *   const buyers = bleedFor("buyers");
 *   buyers.info("start", "fetching …");
 */
class BleedDirectory {
  private stores = new Map<string, BleedStore>();

  get(name = "default"): BleedStore {
    let s = this.stores.get(name);
    if (!s) {
      s = new BleedStore({ max: 2000, enabled: true });
      this.stores.set(name, s);
    }
    return s;
  }

  /** convenience passthroughs */
  info(ns: string, msg: string, data?: unknown): void { this.get(ns).info(ns, msg, data); }
  debug(ns: string, msg: string, data?: unknown): void { this.get(ns).debug(ns, msg, data); }
  warn(ns: string, msg: string, data?: unknown): void { this.get(ns).warn(ns, msg, data); }
  error(ns: string, msg: string, data?: unknown): void { this.get(ns).error(ns, msg, data); }

  /** toggle all */
  enableAll(on = true): void { for (const s of this.stores.values()) s.enable(on); }
  clearAll(): void { for (const s of this.stores.values()) s.clear(); }
}

export const directory = new BleedDirectory();

/** Default shared store (ns="default"). */
export const bleedStore: BleedStore = directory.get("default");

/** Backward-compat convenience aliases that many codebases use. */
export const bleed = bleedStore;
export const Bleed = bleedStore;

/** Get a named store (e.g., `bleedFor("buyers")`). */
export function bleedFor(ns = "default"): BleedStore {
  return directory.get(ns);
}

/** Common helpers (exported for convenience). */
export function logInfo(ns: string, msg: string, data?: unknown) { directory.info(ns, msg, data); }
export function logWarn(ns: string, msg: string, data?: unknown) { directory.warn(ns, msg, data); }
export function logError(ns: string, msg: string, data?: unknown) { directory.error(ns, msg, data); }
export function logDebug(ns: string, msg: string, data?: unknown) { directory.debug(ns, msg, data); }

export default bleedStore;