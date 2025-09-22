// src/services/metrics.ts
// In-memory metrics + FOMO counters (safe for free/demo use).
// No external deps, works in Node 18/20, TypeScript strict-friendly.

type Temp = "warm" | "hot";

// Keep recent "view" events per host so we can show live-ish watchers.
// We also keep simple aggregate counters you can expose internally if you want.
interface Counters {
  shownWarm: number;
  shownHot: number;
  viewed: number;
}

const RECENT_WINDOW_MS = 10 * 60 * 1000; // count "watching" viewers in last 10 minutes
const CLEANUP_EVERY_MS = 60 * 1000; // periodic pruning

// In-memory state
const counters: Map<string, Counters> = new Map();
const recentViews: Map<string, number[]> = new Map();

// ---------- utilities ----------

function now(): number {
  return Date.now();
}

function getCounters(host: string): Counters {
  let c = counters.get(host);
  if (!c) {
    c = { shownWarm: 0, shownHot: 0, viewed: 0 };
    counters.set(host, c);
  }
  return c;
}

function pushView(host: string, ts: number) {
  let arr = recentViews.get(host);
  if (!arr) {
    arr = [];
    recentViews.set(host, arr);
  }
  arr.push(ts);
}

function pruneOld(host: string, ts: number) {
  const arr = recentViews.get(host);
  if (!arr || arr.length === 0) return;
  const cutoff = ts - RECENT_WINDOW_MS;
  // fast in-place prune
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

// A baseline that is NEVER zero, varies by hour of day so it feels alive.
// You asked for "demo counters" that don't show 0; this honors that requirement.
function hourlyBaseline(utcHour: number): number {
  // very light overnight, ramps after 6–7 UTC, peaks mid-day, cools evening.
  // tweak numbers any time; they never drop to 0.
  const table = [
    1, 1, 1, 1, 1, 2, // 00–05
    3, 4, 5, 6, 7, 8, // 06–11
    9, 10, 10, 9, 8, 7, // 12–17
    6, 5, 4, 3, 2, 2 // 18–23
  ];
  return table[Math.max(0, Math.min(23, utcHour))];
}

// Slight per-host jitter so different leads don't all show the exact same number.
function perHostJitter(host: string): number {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  // jitter ∈ {0,1,2}
  return h % 3;
}

// ---------- public-ish API we can call from routes/services ----------

/**
 * Record that a candidate for a host was shown to the user (we created a lead).
 * Call this when your "find buyers" endpoint picks a final lead to display.
 */
export function recordLeadShown(host: string, temp: Temp): void {
  const c = getCounters(host);
  if (temp === "hot") c.shownHot++;
  else c.shownWarm++;
}

/**
 * Record that the user actually viewed (expanded/clicked) the lead tile.
 * Call this from your "lead open" endpoint, or right after you render a row.
 */
export function recordLeadViewed(host: string): void {
  const c = getCounters(host);
  c.viewed++;
  const t = now();
  pushView(host, t);
  pruneOld(host, t);
}

/**
 * Compute current "watching" number for a host. This is:
 *   baseline(hour) + recent viewers in the last 10 min + small per-host jitter.
 * It never returns 0 (baseline ≥ 1).
 */
export function getFomo(host: string): { watching: number } {
  const t = now();
  pruneOld(host, t);
  const arr = recentViews.get(host) || [];
  const hour = new Date(t).getUTCHours();
  const watching = hourlyBaseline(hour) + arr.length + perHostJitter(host);
  return { watching };
}

/**
 * Aggregate metrics intended for public/free-panel consumption.
 * (No sensitive counts, just totals to show the system is working.)
 */
export function getPublicMetrics() {
  let warm = 0,
    hot = 0,
    views = 0;
  for (const c of counters.values()) {
    warm += c.shownWarm;
    hot += c.shownHot;
    views += c.viewed;
  }
  return {
    leadsShown: warm + hot,
    warmShown: warm,
    hotShown: hot,
    views
  };
}

/**
 * Optional express middleware (noop placeholder) — kept for wiring symmetry
 * in case index.ts already calls it. Safe to include or ignore.
 */
export function metricsMiddleware(
  _req: any,
  _res: any,
  next: () => void
): void {
  next();
}

// ---------- background cleanup (keeps memory stable on long-running pods) ----------

let _timer: NodeJS.Timeout | undefined;
function ensureCleaner() {
  if (_timer) return;
  _timer = setInterval(() => {
    const t = now();
    for (const [host] of recentViews) pruneOld(host, t);
  }, CLEANUP_EVERY_MS);
  // If running in serverless, the process may exit at will — that's fine.
}
ensureCleaner();

// Default export AND named exports — so any import style compiles.
const metrics = {
  recordLeadShown,
  recordLeadViewed,
  getFomo,
  getPublicMetrics,
  metricsMiddleware
};
export default metrics;