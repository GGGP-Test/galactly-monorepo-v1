// src/routes/health.ts
// A tiny, shape-safe health endpoint.
// Exposes all forms: handler, register(app), and a Router (default export).

import type { Application, Request, Response } from "express";
import { Router } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";

// Normalize any supported catalog shape to BuyerRow[]
function toArray(cat: unknown): BuyerRow[] {
  const any = cat as any;
  if (Array.isArray(any)) return any as BuyerRow[];
  if (Array.isArray(any?.rows)) return any.rows as BuyerRow[];
  if (Array.isArray(any?.items)) return any.items as BuyerRow[];
  return [];
}

// Reusable handler (so you can do app.get("/health", healthHandler))
export function healthHandler(_req: Request, res: Response): void {
  // loadCatalog() is synchronous in our shared module; safe to call directly.
  const cat = loadCatalog();
  const rows = toArray(cat);

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    catalog: { total: rows.length },
  });
}

// Registrar (so you can do registerHealth(app) if you prefer)
export function registerHealth(app: Application, path = "/health"): void {
  app.get(path, healthHandler);
}

// Router form (mount with app.use(HealthRouter) or app.use("/", HealthRouter))
const HealthRouter = Router();
HealthRouter.get("/health", healthHandler);

export default HealthRouter;