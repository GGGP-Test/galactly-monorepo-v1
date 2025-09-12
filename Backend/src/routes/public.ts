// src/routes/public.ts
import type { Express, Request, Response } from "express";

export type Temp = "hot" | "warm";

export interface Lead {
  id: string;
  host: string;
  platform: string;
  title: string;
  createdAt: string;
  temp: Temp;
  why: string;
  region?: string;
}

type LeadsStore = { hot: Lead[]; warm: Lead[] };

function getStore(reqOrApp: any): LeadsStore {
  const app = "locals" in reqOrApp ? reqOrApp : reqOrApp.app;
  if (!app.locals.leadsStore) {
    app.locals.leadsStore = { hot: [], warm: [] } as LeadsStore;
  }
  return app.locals.leadsStore as LeadsStore;
}

export default function mountPublic(app: Express) {
  // NOTE: This is intentionally lenient—used by the free panel.
  app.get("/api/v1/leads", (req: Request, res: Response) => {
    const tempQ = (String(req.query.temp || "hot").toLowerCase() as Temp) || "hot";
    const regionQ = (req.query.region ? String(req.query.region) : undefined)?.toLowerCase();
    const store = getStore(app);

    const pool = tempQ === "warm" ? store.warm : store.hot;
    const items = regionQ ? pool.filter((l) => (l.region || "").toLowerCase() === regionQ) : pool;

    console.log(
      `[public] GET /leads -> 200 temp=${tempQ} region=${regionQ ?? "any"} count=${items.length}`
    );
    res.status(200).json({ ok: true, items });
  });

  // Handy for manual resets while testing
  app.delete("/api/v1/leads", (_req: Request, res: Response) => {
    const store = getStore(app);
    store.hot = [];
    store.warm = [];
    res.status(200).json({ ok: true, cleared: true });
  });
}
