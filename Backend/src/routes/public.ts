import { Router, Request, Response } from "express";

// If you already have a BLEED store instance elsewhere, we read it from global.
// This avoids circular imports and keeps this file self-contained.
type LeadRecord = {
  id: string;
  tenantId: string;
  source: string;
  company?: string;
  domain?: string;
  website?: string;
  country?: string;
  region?: string;
  verticals?: string[];
  signals?: Record<string, number>;
  scores?: Record<string, number>;
  contacts?: any[];
  status: string;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
};

const router = Router();

// Healthcheck used by the platform
router.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).send("ok");
});

// Read-only leads list for the Free Panel (kept lenient)
router.get("/leads", async (req: Request, res: Response) => {
  try {
    const tenantId = (req.headers["x-tenant-id"] as string) || "t_demo";
    const temp = String(req.query.temp || "warm");   // warm|hot (UI sends this)
    const region = String(req.query.region || "usca");

    const store: any = (globalThis as any).__BLEED_STORE;
    let items: LeadRecord[] = [];

    if (store?.listLeads) {
      // Best-effort; ignore temp/region in this stub unless your store tracks them.
      items = await store.listLeads(tenantId, { limit: 100 });
    }

    console.log(`[public] GET /leads -> 200 temp=${temp} region=${region} count=${items.length}`);
    res.status(200).json({ ok: true, items });
  } catch (err: any) {
    console.error("[public] /leads error:", err?.message || err);
    res.status(200).json({ ok: true, items: [] }); // fail leniently for the panel
  }
});

export default router;