// src/routes/public.ts
import { Router, type Request, type Response } from "express";

/**
 * Public, lenient endpoints:
 *  - GET /api/v1/healthz
 *  - GET /api/v1/leads   (reads from global BLEED store if present)
 *
 * This mounts defensively: if the host isn't an Express app, we just return the router.
 */
export default function mountPublic(host: unknown) {
  const r = Router();

  // Healthcheck
  r.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // Leads list (hot/warm) – reads from global BLEED store populated by buyers.ts
  r.get("/leads", async (req: Request, res: Response) => {
    try {
      const g = globalThis as any;
      const store = g.__BLEED_STORE__;
      const apiKey = (req.headers["x-api-key"] || "").toString();
      const tenantId = apiKey ? t_${apiKey.slice(0, 8)} : "t_public";

      const temp = String(req.query.temp || "warm").toLowerCase(); // 'hot' | 'warm'
      const region = String(req.query.region || "").toLowerCase();

      let items: any[] = [];
      if (store && typeof store.listLeads === "function") {
        items = await store.listLeads(tenantId, { limit: 200 });
      }

      if (region) {
        items = items.filter((l) => (l.region || "").toLowerCase() === region);
      }

      // simple temp split on intent score
      const isHot = (l: any) => (l?.scores?.intent ?? 0) >= 0.7;
      items = temp === "hot" ? items.filter(isHot) : items.filter((l) => !isHot(l));

      console.log(
        [public] GET /leads -> 200 temp=${temp} region=${region || "-"} count=${items.length}
      );
      res.status(200).json({ ok: true, items, count: items.length });
    } catch (err: any) {
      console.error("[public] /leads error", err?.stack || err);
      res.status(200).json({ ok: true, items: [], count: 0 }); // lenient
    }
  });

  // CORS preflight helper (keeps the panel happy)
  r.options("*", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    res.status(204).end();
  });

  // Mount defensively
  if (host && typeof (host as any).use === "function") {
    (host as any).use("/api/v1", r);
  } else {
    console.warn("[routes] public: host has no .use(); returning router.");
  }
  return r;
}
