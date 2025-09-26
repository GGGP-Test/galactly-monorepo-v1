// src/routes/catalog.ts
//
// Read-only endpoints to inspect the loaded buyer catalog.
// Safe against shape drift (array | {rows} | {items}).
// Exposes both a Router (default export) and registerCatalog(app, base).

import { Router, Request, Response, type Application } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";

export const CatalogRouter = Router();

type Loaded = unknown;

// Normalize any supported shape to an array
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

CatalogRouter.get("/api/catalog/stats", async (_req: Request, res: Response) => {
  try {
    const cat = await loadCatalog();
    const rows = toArray(cat);

    const byTier: Record<string, number> = {};
    const cityCount: Record<string, number> = {};

    for (const r of rows) {
      const tiers = arr((r as any).tiers);
      if (tiers.length === 0) tiers.push("?");
      for (const t of tiers) byTier[t] = (byTier[t] || 0) + 1;

      const cities = arr((r as any).cityTags);
      for (const c of cities) cityCount[c.toLowerCase()] = (cityCount[c.toLowerCase()] || 0) + 1;
    }

    const topCities = Object.entries(cityCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([city, count]) => ({ city, count }));

    const exampleHosts = rows.slice(0, 25).map((r) => ({
      host: asStr((r as any).host),
      name: asStr((r as any).name || (r as any).title),
      tiers: arr((r as any).tiers),
      cityTags: arr((r as any).cityTags),
    }));

    return res.json({
      total: rows.length,
      byTier,
      topCities,
      exampleHosts,
    });
  } catch (err: any) {
    return res.status(200).json({ error: "catalog-stats-failed", detail: String(err?.message || err) });
  }
});

CatalogRouter.get("/api/catalog/sample", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const cat = await loadCatalog();
    const rows = toArray(cat).slice(0, limit);

    const items = rows.map((r) => ({
      host: asStr((r as any).host),
      name: asStr((r as any).name || (r as any).title),
      tiers: arr((r as any).tiers),
      tags: arr((r as any).tags),
      cityTags: arr((r as any).cityTags),
      segments: arr((r as any).segments),
    }));

    return res.json({ items, total: items.length });
  } catch (err: any) {
    return res.status(200).json({ error: "catalog-sample-failed", detail: String(err?.message || err) });
  }
});

// (Optional) no-op reload to keep contract future-proof.
// If loadCatalog caches, re-invoking will refresh that cache.
CatalogRouter.post("/api/catalog/reload", async (_req: Request, res: Response) => {
  try {
    await loadCatalog();
    return res.json({ ok: true, reloaded: true, at: new Date().toISOString() });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "catalog-reload-failed", detail: String(err?.message || err) });
  }
});

// Convenience mount helper (mirrors leads/health style)
export function registerCatalog(app: Application, base = "/"): void {
  app.use(base, CatalogRouter);
}

// export both named & default to avoid import style issues
export default CatalogRouter;