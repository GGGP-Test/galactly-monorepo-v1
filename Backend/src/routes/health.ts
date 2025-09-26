import type { Express, Request, Response } from "express";
import { loadCatalog } from "../shared/catalog";

/**
 * Lightweight health/readiness probe.
 * - 200 when catalog loads
 * - 500 if secrets/cat loading fail
 * - echoes presence of AB/C secrets (no values)
 * - includes small sample of hosts for quick sanity check
 */
export function registerHealth(app: Express) {
  app.get("/healthz", async (_req: Request, res: Response) => {
    const started = Date.now();
    let ok = true;
    let rowsLen = 0;
    let sample: string[] = [];
    let error: string | undefined;

    try {
      const rows = await loadCatalog();
      rowsLen = rows.length;
      sample = rows.slice(0, 3).map(r => r.host);
    } catch (e: unknown) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }

    res.status(ok ? 200 : 500).json({
      ok,
      ts: new Date().toISOString(),
      ms: Date.now() - started,
      env: {
        HAS_AB: Boolean(process.env.BUYERS_CATALOG_TIER_AB_JSON),
        HAS_C: Boolean(process.env.BUYERS_CATALOG_TIER_C_JSON),
        NODE_ENV: process.env.NODE_ENV || "development",
      },
      catalog: {
        rows: rowsLen,
        sample,
      },
      error,
    });
  });
}