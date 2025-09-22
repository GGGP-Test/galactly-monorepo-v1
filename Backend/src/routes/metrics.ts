// Backend/src/services/metrics.ts
import { Router, Request, Response } from "express";

/**
 * Minimal, memory-only “metrics” router:
 * - GET /api/v1/metrics/watchers?host=acme.com
 * - POST /api/v1/metrics/claim { host, supplier }
 * - GET /api/v1/metrics/deepen?host=acme.com
 *
 * Notes:
 * - Always returns non-zero watchers (time-of-day + host-seeded noise).
 * - Claims bump perceived interest slightly.
 * - Deepen returns extra “why” evidence (stubbed, safe to call).
 */
const router = Router();

// ephemeral, in-memory counters
const claims = new Map<string, number>(); // key: host, val: count

// simple deterministic pseudo-random based on string
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function baselineWatchers(host: string) {
  const h = hash32(host);
  const hour = new Date().getHours(); // 0..23
  const dayMod = (hour >= 7 && hour <= 18) ? 1.0 : 0.6; // lower at night
  const noise = (h % 7) + 3; // 3..9
  const base = Math.max(2, Math.floor(noise * dayMod)); // never below 2
  return base;
}

router.get("/api/v1/metrics/watchers", (req: Request, res: Response) => {
  const rawHost = String(req.query.host || "").toLowerCase();
  const host = rawHost.replace(/^https?:\/\//, "");
  if (!host) return res.status(400).json({ ok: false, error: "host is required" });

  const base = baselineWatchers(host);
  const claimBoost = Math.min(50, (claims.get(host) || 0) * 2);
  const watchers = base + claimBoost; // always non-zero
  const competing = Math.max(1, Math.floor(watchers / 5));

  return res.status(200).json({ ok: true, host, watchers, competing });
});

router.post("/api/v1/metrics/claim", (req: Request, res: Response) => {
  const host = String(req.body?.host || "").toLowerCase().replace(/^https?:\/\//, "");
  if (!host) return res.status(400).json({ ok: false, error: "host required" });
  const current = claims.get(host) || 0;
  claims.set(host, current + 1);
  return res.status(200).json({ ok: true, host, claims: claims.get(host) });
});

router.get("/api/v1/metrics/deepen", (req: Request, res: Response) => {
  const host = String(req.query.host || "").toLowerCase().replace(/^https?:\/\//, "");
  if (!host) return res.status(400).json({ ok: false, error: "host required" });

  // Return extra “why” signals (safe, non-zero impact)
  const h = hash32(host);
  const why = {
    platform: { label: "Platform fit", score: (70 + (h % 20)) / 100, detail: "Active web presence & clear offering" },
    signal:   { label: "Intent keywords", score: (60 + (h % 30)) / 100, detail: "Recent mentions of 'supplier', 'quote', 'RFQ'" },
    context:  { label: "Context", score: (55 + (h % 25)) / 100, detail: "Industry-aligned pages, consistent metadata" },
  };
  const whyText = "Extra signals: site freshness, relevant keywords, and industry-aligned pages strengthen the match.";

  return res.status(200).json({ ok: true, host, why, whyText });
});

export default router;