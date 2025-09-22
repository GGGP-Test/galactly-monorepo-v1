// Tiny in-memory store shared across routes (no external deps)

export type WatcherCounts = Record<string, number>;

class MemStore {
  private watchers: WatcherCounts = {};

  reset() {
    this.watchers = {};
  }

  getWatchers(host: string): number {
    if (!host) return 0;
    return this.watchers[host] ?? 0;
  }

  incWatcher(host: string, by = 1): number {
    if (!host) return 0;
    this.watchers[host] = (this.watchers[host] ?? 0) + by;
    return this.watchers[host];
  }
}

const memStore = new MemStore();
export default memStore;
export { memStore };