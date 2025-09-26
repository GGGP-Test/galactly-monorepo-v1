// src/routes/leads.ts
import { Router } from "express";
import { getPrefs, setPrefs, prefsSummary, EffectivePrefs } from "../shared/prefs";
import { queryCatalog } from "../shared/catalog";

const router = Router();

// Accept JSON just for this router (index.ts also applies app-wide)
router.use((req, res, next) => {
  // Northflank Express images already include express.json in index.ts,
  // but keeping this guard makes the route self-contained.
  // @ts-ignore
  if (!("json" in req)) return next();
  next();
});

// GET /api/leads/find-buyers?host=...&region=US%2FCA&radius=50mi
router.get("/leads/find-buyers", (req, res) => {
  const host = String(req.query.host || "").trim();
  if (!host) return res.status(400).json({ error: "host required" });

  const city = (req.query.city ? String(req.query.city) : "").trim() || undefined;

  // resolve effective prefs (bias to small/mid + tier C/B)
  let prefs: EffectivePrefs = getPrefs(host);
  if (city && city !== prefs.city) {
    prefs = setPrefs(host, { city });
  }

  const items = queryCatalog(prefs, prefs.maxWarm);

  // Attach a readable “why” footer with prefs summary
  for (const it of items) {
    it.why = `${it.why} · ${prefsSummary(prefs)}`;
  }

  return res.json({ items });
});

// POST /api/leads/lock  { host, title, temp, why, platform }
router.post("/leads/lock", (req, res) => {
  try {
    const body = req.body || {};
    if (!body || !body.host || !body.title) {
      return res.status(400).json({ error: "candidate with host and title required" });
    }
    // In this minimal impl we just acknowledge the lock.
    // You can persist to Neon later; the API surface won’t change.
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "lock failed" });
  }
});

// Optional: quick prefs setter used by your free panel
router.post("/prefs", (req, res) => {
  const { host, patch } = req.body || {};
  if (!host) return res.status(400).json({ error: "host required" });
  const eff = setPrefs(host, patch || {});
  res.json({ ok: true, prefs: eff });
});

// Simple ping used by the Docker HEALTHCHECK
router.get("/healthz", (_req, res) => res.json({ ok: true }));

export default router;