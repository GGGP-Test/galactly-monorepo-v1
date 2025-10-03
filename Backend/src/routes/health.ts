// src/routes/health.ts
//
// Lightweight health + status without extra deps.
// - GET /api/health            -> uptime/env + catalog summary
// - GET /api/health/ping       -> simple pong
// - (helper) registerHealthz(app) -> GET /healthz  (plain text "ok" for container healthchecks)

import { Router, type Request, type Response, type Express } from "express";
import { getCatalog, type BuyerRow } from "../shared/catalog";
import { summarizeForHealth } from "../shared/env";

const r = Router();

/* ----------------------------- tiny helpers ------------------------------ */

type Loaded = unknown;

function toArray(cat: Loaded): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

function asStr(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((x) => asStr(x)).filter(Boolean);
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

    const cat = getCatalog(); // cached build from env/file
    const rows = toArray(cat);

    // summarize tiers + small sample
    const byTier: Record<string, number> = {};
    for (const row of rows.slice(0, 200)) {
      const tiers = arr((row as any).tiers);
      if (tiers.length === 0) tiers.push("?");
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
      env: summarizeForHealth(), // safe summary from shared/env.ts
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

// Call this from index.ts so /healthz exists at the root (matches Dockerfile)
export function registerHealthz(app: Express) {
  app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));
}

export default r;