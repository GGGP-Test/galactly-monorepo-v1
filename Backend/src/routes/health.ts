// src/routes/health.ts
//
// Rich health endpoint with defensive catalog stats.
// - Works whether the catalog is [] | {rows} | {items}
// - No implicit-any; no new dependencies
// - Tiny in-process cache to keep it cheap

import { Router, Request, Response } from "express";
import { loadCatalog } from "../shared/catalog";

const HealthRouter = Router();

// ---- helpers ----
type AnyCat = unknown;

function toArray(cat: AnyCat): any[] {
  const c: any = cat as any;
  if (Array.isArray(c)) return c as any[];
  if (Array.isArray(c?.rows)) return c.rows as any[];
  if (Array.isArray(c?.items)) return c.items as any[];
  return [];
}

function asStr(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((x) => asStr(x)).filter(Boolean);
}

// ---- cheap TTL cache for stats ----
type CatalogStats = {
  total: number;
  byTier: Record<string, number>;
  sampleHosts: string[];
};

let STATS_CACHE: CatalogStats | null = null;
let STATS_AT = 0;
const STATS_TTL_MS = 15_000;

function computeStats(): CatalogStats {
  const cat = loadCatalog(); // sync; safe to call without await
  const rows = toArray(cat);

  const byTier: Record<string, number> = {};
  const sampleHosts: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r: any = rows[i];
    if (sampleHosts.length < 10) {
      const host = asStr(r?.host);
      if (host) sampleHosts.push(host.toLowerCase());
    }
    const tiers = arr(r?.tiers);
    if (tiers.length === 0) tiers.push("?");
    for (let j = 0; j < tiers.length; j++) {
      const t = tiers[j];
      byTier[t] = (byTier[t] || 0) + 1;
    }
  }

  return { total: rows.length, byTier, sampleHosts };
}

function getStats(): CatalogStats {
  const now = Date.now();
  if (!STATS_CACHE || now - STATS_AT > STATS_TTL_MS) {
    STATS_CACHE = computeStats();
    STATS_AT = now;
  }
  return STATS_CACHE;
}

// ---- routes ----
HealthRouter.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

HealthRouter.get("/health", (_req: Request, res: Response) => {
  const s = getStats();
  res.json({
    ok: true,
    service: "buyers-api",
    node: process.version,
    env: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 8787),
    uptimeSec: Math.round(process.uptime()),
    nowIso: new Date().toISOString(),
    catalog: s,
  });
});

export default HealthRouter;