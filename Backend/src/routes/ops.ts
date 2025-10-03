// src/routes/ops.ts
//
// Minimal admin ops (no external deps):
//   GET    /api/ops              -> status summary (uptime, env, catalog counts)
//   GET    /api/ops/env          -> env summary (safe fields)
//   POST   /api/ops/clear-cache  -> clear in-process TTL cache (shared/guards)
//   POST   /api/ops/reload-catalog -> rebuild catalog from env/file
//
// Auth rules:
// - If ADMIN_API_KEY is set: require x-admin-key (or x-api-key) header to match.
// - If not set: allow only local requests (127.0.0.1 / ::1).

import { Router, Request, Response, NextFunction } from "express";
import { getCatalog, loadCatalog, type BuyerRow } from "../shared/catalog";
import { cache } from "../shared/guards";
import { summarizeForHealth } from "../shared/env";

const r = Router();

const ADMIN_KEY =
  String(process.env.ADMIN_API_KEY || process.env.X_ADMIN_KEY || "").trim();

function isLocalReq(req: Request): boolean {
  const ip = (req.ip || req.socket.remoteAddress || "").toString();
  const v = ip.replace("::ffff:", "");
  return v === "127.0.0.1" || v === "::1";
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (ADMIN_KEY) {
    const key =
      (req.headers["x-admin-key"] as string) ||
      (req.headers["x-api-key"] as string) ||
      "";
    if (key && key === ADMIN_KEY) return next();
    return res.status(401).json({ ok: false, error: "admin_key_required" });
  }
  // No key configured: allow only local requests (safer default)
  if (isLocalReq(req)) return next();
  return res
    .status(401)
    .json({ ok: false, error: "admin_only_local_when_unset" });
}

// ---- tiny helpers to avoid shape drift ----
type Loaded = unknown;
function toArray(cat: Loaded): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

// ---- routes ----

// Status summary
r.get("/", (_req, res) => {
  try {
    const health = summarizeForHealth();
    const rows = toArray(getCatalog());
    res.json({
      ok: true,
      now: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime ? process.uptime() : 0),
      env: health,
      catalog: { total: rows.length },
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

// Env snapshot (safe)
r.get("/env", (_req, res) => {
  try {
    res.json({ ok: true, env: summarizeForHealth() });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

// Clear TTL cache (guards)
r.post("/clear-cache", requireAdmin, (_req, res) => {
  try {
    // `cache` is our singleton TTLCache<string, unknown>
    cache.clear();
    res.json({ ok: true, cleared: true, at: new Date().toISOString() });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

// Reload catalog from env/file
r.post("/reload-catalog", requireAdmin, (_req, res) => {
  try {
    const cat = loadCatalog();
    const rows = toArray(cat);
    res.json({
      ok: true,
      reloaded: true,
      total: rows.length,
      at: new Date().toISOString(),
    });
  } catch (err: any) {
    res
      .status(200)
      .json({ ok: false, error: "reload-failed", detail: String(err?.message || err) });
  }
});

export default r;