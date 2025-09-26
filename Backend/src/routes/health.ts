// src/routes/health.ts
//
// Lightweight health + status without extra deps.
// - GET /api/health            -> uptime/env + catalog summary (safe against shape drift)
// - GET /api/health/ping       -> simple pong
//
// No external packages. Default export = Router.

import { Router, Request, Response } from "express";
import { getCatalog, type BuyerRow } from "../shared/catalog";

const r = Router();

// ---- tiny helpers (avoid implicit-any) ----
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

// ---- routes ----

// Simple liveness
r.get("/ping", (_req: Request, res: Response) => {
  res.json({ pong: true, at: new Date().toISOString() });
});

// Uptime + small catalog snapshot (safe in prod logs)
r.get("/", (_req: Request, res: Response) => {
  try {
    const startedAt = Number(process.uptime ? Date.now() - process.uptime() * 1000 : Date.now());
    const cat = getCatalog(); // cached build from env
    const rows = toArray(cat);

    // summarize tiers & a tiny sample (no heavy work)
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
      uptimeSec: Math.round(process.uptime ? process.uptime() : 0),
      startedAtIso: new Date(startedAt).toISOString(),
      env: {
        node: process.version,
        port: Number(process.env.PORT || 8080),
        allowOrigins: String(process.env.ALLOW_ORIGINS || ""),
      },
      catalog: {
        total: rows.length,
        byTier,
        sample,
      },
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
});

export default r;