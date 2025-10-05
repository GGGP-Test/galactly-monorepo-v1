// src/routes/catalog.ts
//
// Read-only endpoints to inspect the loaded buyer catalog.
// Mounted from index.ts as: app.use("/api/catalog", CatalogRouter)
//
// Endpoints:
//   GET  /api/catalog            -> summary stats (+ source, loadedAt)
//   GET  /api/catalog/sample     -> small sample list (?limit=20)
//   POST /api/catalog/reload     -> rebuild in-memory cache from env  (ADMIN-ONLY; x-admin-key)

import { Router, type Request, type Response, type NextFunction } from "express";
import { loadCatalog, reload as reloadCatalog, type BuyerRow } from "../shared/catalog";

const CatalogRouter = Router();

/* ----------------------------- inline admin ------------------------------ */

function adminKey(): string | undefined {
  const a = String(process.env.ADMIN_KEY || "").trim();
  const b = String(process.env.ADMIN_TOKEN || "").trim();
  return (a || b) || undefined;
}
function adminAllowed(req: Request): boolean {
  const need = adminKey();
  if (!need) return true; // allow in dev if not configured
  const got = String(req.headers["x-admin-key"] || "").trim();
  return !!got && got === need;
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!adminAllowed(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized", need: "x-admin-key" });
  }
  next();
}

/* -------------------------------- helpers -------------------------------- */

type Loaded = unknown;

function toArray(cat: Loaded): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}
const asStr = (v: unknown) => (v == null ? "" : String(v)).trim();
function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).map((x) => asStr(x)).filter(Boolean);
}

/* -------------------------------- routes --------------------------------- */

// GET /api/catalog  -> summary
CatalogRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const cat: any = await loadCatalog(); // { rows,total,byTier,loadedAt,source }
    const rows = toArray(cat);

    const byTier: Record<string, number> = {};
    const cityCount: Record<string, number> = {};

    for (const r of rows) {
      const tiers = arr((r as any).tiers);
      if (tiers.length === 0) tiers.push("?");
      for (const t of tiers) byTier[t] = (byTier[t] || 0) + 1;

      const cities = arr((r as any).cityTags);
      for (const c of cities) {
        const k = c.toLowerCase();
        cityCount[k] = (cityCount[k] || 0) + 1;
      }
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

    res.json({
      ok: true,
      total: rows.length,
      byTier,
      topCities,
      exampleHosts,
      loadedAt: cat?.loadedAt || null,
      source: cat?.source || null,
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "catalog-stats-failed", detail: String(err?.message || err) });
  }
});

// GET /api/catalog/sample?limit=20
CatalogRouter.get("/sample", async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
    const cat: any = await loadCatalog();
    const rows = toArray(cat).slice(0, limit);

    const items = rows.map((r) => ({
      host: asStr((r as any).host),
      name: asStr((r as any).name || (r as any).title),
      tiers: arr((r as any).tiers),
      tags: arr((r as any).tags),
      cityTags: arr((r as any).cityTags),
      segments: arr((r as any).segments),
    }));

    res.json({ ok: true, items, total: items.length });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "catalog-sample-failed", detail: String(err?.message || err) });
  }
});

// POST /api/catalog/reload  (ADMIN-ONLY; send x-admin-key)
CatalogRouter.post("/reload", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const cat: any = await reloadCatalog();
    res.json({
      ok: true,
      reloaded: true,
      at: new Date().toISOString(),
      total: cat?.total ?? (Array.isArray(cat?.rows) ? cat.rows.length : null),
      byTier: cat?.byTier ?? null,
      loadedAt: cat?.loadedAt ?? null,
      source: cat?.source ?? null,
    });
  } catch (err: any) {
    res.status(200).json({ ok: false, error: "catalog-reload-failed", detail: String(err?.message || err) });
  }
});

export default CatalogRouter;