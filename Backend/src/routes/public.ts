// src/routes/public.ts
import { Router } from "express";
import type { Request, Response } from "express";

/**
 * Public, lenient endpoints under /api/v1
 * - GET /api/v1/healthz
 * - GET /api/v1/leads?temp=hot|warm&region=usca
 *
 * Reads from global BLEED store if present (populated by buyers.ts).
 */
export default function mountPublic(host: unknown) {
  const r = Router();

  // permissive CORS for the free panel
  r.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  r.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  r.get("/leads", async (req: Request, res: Response) => {
    try {
      const g = globalThis as any;
      const store = g && g.__BLEED_STORE__;

      // tenant derived from API key (same convention used elsewhere)
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
    } catch (err) {
      console.error("[public] /leads error", err);
      // keep it lenient for the panel even on error
      res.status(200).json({ ok: true, items: [], count: 0 });
    }
  });

  // mount defensively (works whether caller passes an app or just imports the router)
  if (host && typeof (host as any).use === "function") {
    (host as any).use("/api/v1", r);
  } else {
    console.warn("[routes] public: host has no .use(); returning router only.");
  }
  return r;
}
