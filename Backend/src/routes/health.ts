// src/routes/health.ts
//
// Lightweight health + status (zero fragile imports).
// - GET /api/health      -> uptime/env + catalog summary
// - GET /api/health/ping -> simple pong
// - (optional) registerHealthz(app) -> /healthz returns "ok"

import { Router, type Request, type Response, type Express } from "express";
import { summarizeForHealth } from "../shared/env";

/* eslint-disable @typescript-eslint/no-var-requires */
let CatalogMod: any = null;
try { CatalogMod = require("../shared/catalog"); } catch { /* optional */ }

const r = Router();

/* ----------------------------- tiny helpers ------------------------------ */

type BuyerRow = Record<string, unknown>;

function asStr(v: unknown): string { return (v == null ? "" : String(v)).trim(); }
function arr(v: unknown): string[] { return Array.isArray(v) ? (v as unknown[]).map(asStr).filter(Boolean) : []; }

function toArrayLoose(anyCat: any): BuyerRow[] {
  // Accept array, {rows}, {items}, default[], or function getters
  try {
    if (!anyCat) return [];
    if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
    if (typeof anyCat.getCatalog === "function") return toArrayLoose(anyCat.getCatalog());
    if (typeof anyCat.get === "function") return toArrayLoose(anyCat.get());
    if (typeof anyCat.rows === "function") return toArrayLoose(anyCat.rows());
    if (Array.isArray(anyCat.rows)) return anyCat.rows as BuyerRow[];
    if (Array.isArray(anyCat.items)) return anyCat.items as BuyerRow[];
    if (Array.isArray(anyCat.catalog)) return anyCat.catalog as BuyerRow[];
    if (typeof anyCat.all === "function") return toArrayLoose(anyCat.all());
    if (Array.isArray(anyCat.default)) return anyCat.default as BuyerRow[];
    return [];
  } catch { return []; }
}

function readCatalogRows(): BuyerRow[] {
  return toArrayLoose(CatalogMod);
}

/* -------------------------------- routes --------------------------------- */

// Simple liveness for API namespace
r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

// Uptime + tiny catalog snapshot (safe for logs; no heavy compute)
r.get("/", (_req: Request, res: Response) => {
  try {
    const upSec = Math.round(typeof process.uptime === "function" ? process.uptime() : 0);
    const startedAt = new Date(Date.now() - upSec * 1000).toISOString();

    const rows = readCatalogRows();

    // summarize tiers + small sample
    const byTier: Record<string, number> = {};
    for (const row of rows.slice(0, 200)) {
      const tiers = arr((row as any).tiers);
      if (tiers.length === 0) tiers.push("C"); // default to C tier when unknown
      for (const t of tiers) byTier[t] = (byTier[t] || 0) + 1;
    }

    const sample = rows.slice(0, 12).map((row) => ({
      host: asStr((row as any).host),
      name: asStr((row as any).name || (row as any).title),
      tiers: arr((row as any).tiers),
      cityTags: arr((row as any).cityTags),
      segments: arr((row as any).segments),
    }));

    res.json({
      ok: true,
      service: "buyers-api",
      now: new Date().toISOString(),
      uptimeSec: upSec,
      startedAtIso: startedAt,
      env: summarizeForHealth(),
      catalog: {
        total: rows.length,
        byTier,
        sample,
      },
    });
  } catch (err: unknown) {
    const msg = (err as any)?.message || String(err);
    res.status(200).json({ ok: false, error: msg });
  }
});

/* ------------------------ root healthcheck helper ------------------------ */

// Optional: only needed if you want /healthz mounted by this router.
// Your index.ts already registers /healthz, so this is harmless and unused.
export function registerHealthz(app: Express) {
  app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));
}

export default r;