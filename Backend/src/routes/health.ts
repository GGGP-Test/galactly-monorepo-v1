// src/routes/health.ts
//
// Minimal /healthz endpoint that confirms the API is up and the catalog is loaded.
// Matches the current shared/catalog.ts types (LoadedCatalog has an `items` array).

import type { Application, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";

/**
 * Build a tiny snapshot about the catalog for health reporting.
 */
function catalogSnapshot(rows: BuyerRow[]) {
  return {
    total: rows.length,
    sample: rows.slice(0, 3).map((r: BuyerRow) => ({
      host: r.host,
      name: r.name,
      tiers: r.tiers,
    })),
  };
}

/**
 * Registers GET /healthz (and alias /health) on the provided Express app.
 */
export function registerHealth(app: Application): void {
  const handler = async (_req: Request, res: Response) => {
    try {
      const cat = await loadCatalog(); // { items: BuyerRow[], source: 'tierAB' | 'tierC' }
      res.status(200).json({
        ok: true,
        time: new Date().toISOString(),
        catalog: {
          source: cat.source,
          ...catalogSnapshot(cat.items),
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: (err as Error).message || "health check failed",
      });
    }
  };

  app.get("/healthz", handler);
  app.get("/health", handler);
}