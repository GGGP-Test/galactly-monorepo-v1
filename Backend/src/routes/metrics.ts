// src/routes/metrics.ts
import { Router } from "express";
import { saveByHost } from "../shared/memStore";

export const metricsRouter = Router();

// Simple key guard (writes only)
function requireKey(req: any, res: any): boolean {
  const need = process.env.API_KEY || process.env.X_API_KEY;
  if (!need) return true;
  const got = req.header("x-api-key") || req.header("X-Api-Key");
  if (got !== need) {
    res.status(401).json({ ok: false, error: "invalid api key" });
    return false;
  }
  return true;
}

// --- helpers ---------------------------------------------------------------
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Never show zero (FOMO). Stable-ish per host + time bucket.
function demoWatchCounts(host: string) {
  const now = new Date();
  const bucket = Math.floor(now.getUTCMinutes() / 5); // 12 buckets/hour
  const base = (hash(host + ":" + bucket) % 5) + 1;   // 1..5
  const watching = base + (now.getUTCHours() % 2);    // 1..6, tiny day/night drift
  const competing = Math.max(0, Math.floor(watching / 2));
  return { watching, competing };
}

// --- routes ----------------------------------------------------------------

// GET /api/v1/metrics/watchers?host=example.com
metricsRouter.get("/watchers", (req, res) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ ok: false, error: "host required" });
  const { watching, competing } = demoWatchCounts(host);
  res.json({ ok: true, watching, competing });
});

// POST /api/v1/metrics/claim  { host, title? }
metricsRouter.post("/claim", (req, res) => {
  if (!requireKey(req, res)) return;
  const host = String(req.body?.host || "").trim();
  const title = req.body?.title ? String(req.body.title) : undefined;
  if (!host) return res.status(400).json({ ok: false, error: "host required" });

  const saved = saveByHost(host, title);
  res.json({ ok: true, saved });
});

// GET /api/v1/metrics/deepen?host=...
// Free returns soft "pro-only" message (200). You can flip to 403 later.
metricsRouter.get("/deepen", (req, res) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ ok: false, error: "host required" });

  res.json({
    ok: false,
    proOnly: true,
    message:
      "Deepen results is Pro-only. We’ll crawl more sources, unlock extra metrics & notify you on spikes.",
  });
});

export default metricsRouter;