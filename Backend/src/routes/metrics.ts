import { Router, Request, Response } from "express";

/**
 * Minimal, privacy-safe metrics + FOMO counters.
 * - Never returns zero watchers (uses a soft, time-varying baseline).
 * - Keeps everything in-memory (ephemeral) so it's safe to roll out now.
 * - Can be swapped later for Redis/DB without changing the API.
 */

export const metricsRouter = Router();

// --- Types (kept tiny & explicit) ---
type Temp = "hot" | "warm";
interface LeadEventBody {
  host: string;           // canonical domain, e.g. "acme.com"
  temp?: Temp;            // "hot" | "warm" (optional, used for bucketing)
}

// --- In-memory counters ---
const shown = new Map<string, number>();  // key: host
const viewed = new Map<string, number>(); // key: host

// --- Helpers ---
function inc(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Non-zero, time-varying baseline so “watching” never displays 0.
 * Roughly:
 * - Higher during US daytime (15:00–02:00 UTC), lower overnight.
 * - Adds a deterministic per-host jitter so different leads don’t all show the same number.
 *
 * Tunable by env:
 *   FOMO_BASE_MIN (default 1)
 *   FOMO_BASE_MAX (default 7)
 */
function softBaseline(host: string): number {
  const min = Number(process.env.FOMO_BASE_MIN ?? 1);
  const max = Number(process.env.FOMO_BASE_MAX ?? 7);

  const hour = new Date().getUTCHours();
  // US/CA busier ~15:00–02:00 UTC
  const dayBoost = (hour >= 15 || hour <= 2) ? 1.0 : 0.5;

  // Deterministic jitter per host (0..1)
  let h = 2166136261;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const jitter01 = ((h >>> 0) % 1000) / 1000;

  const base = min + (max - min) * (0.25 + 0.75 * jitter01); // bias away from exact min
  return Math.max(1, Math.round(base * dayBoost));
}

/** Public-facing FOMO count: baseline + recent “viewed” + a small share of “shown”. */
function watchingNow(host: string): number {
  const b = softBaseline(host);
  const v = viewed.get(host) ?? 0;
  const s = shown.get(host) ?? 0;

  // Don’t explode; keep lightweight.
  const blended = b + Math.min(3, Math.floor(v * 0.5)) + Math.min(2, Math.floor(s * 0.25));
  return clamp(blended, b, b + 10);
}

// --- Routes ---

// Health for this router
metricsRouter.get("/", (_req, res) => {
  res.json({ ok: true, router: "metrics" });
});

/**
 * Record: a lead was rendered in UI (table/list)
 * POST /api/v1/metrics/lead-shown
 * { host, temp? }
 */
metricsRouter.post("/lead-shown", (req: Request<unknown, unknown, LeadEventBody>, res: Response) => {
  const host = (req.body?.host || "").toString().trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: "MISSING_HOST" });
  inc(shown, host, 1);
  res.json({ ok: true });
});

/**
 * Record: a lead details panel / popup was opened
 * POST /api/v1/metrics/lead-viewed
 * { host, temp? }
 */
metricsRouter.post("/lead-viewed", (req: Request<unknown, unknown, LeadEventBody>, res: Response) => {
  const host = (req.body?.host || "").toString().trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: "MISSING_HOST" });
  inc(viewed, host, 1);
  res.json({ ok: true });
});

/**
 * Get the FOMO counter for a host.
 * GET /api/v1/metrics/fomo?host=acme.com
 * -> { watching: number }
 */
metricsRouter.get("/fomo", (req, res) => {
  const host = (req.query.host || "").toString().trim().toLowerCase();
  if (!host) return res.status(400).json({ ok: false, error: "MISSING_HOST" });
  res.json({ ok: true, watching: watchingNow(host) });
});

/**
 * Very small public snapshot (privacy-safe).
 * GET /api/v1/metrics/public
 * -> { ok, totals: { hostsTracked, shown, viewed } }
 */
metricsRouter.get("/public", (_req, res) => {
  let shownSum = 0;
  let viewedSum = 0;
  for (const v of shown.values()) shownSum += v;
  for (const v of viewed.values()) viewedSum += v;

  res.json({
    ok: true,
    totals: {
      hostsTracked: new Set([...shown.keys(), ...viewed.keys()]).size,
      shown: shownSum,
      viewed: viewedSum,
    },
  });
});

export default metricsRouter; // also provide default for convenience