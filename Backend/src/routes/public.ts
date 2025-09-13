import { Router } from "express";

export default function mountPublic(app) {
  const r = Router();

  // permissive CORS for the free panel
  r.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  r.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  // List leads from the in-memory/global BLEED store, split by "temp"
  r.get("/leads", async (req, res) => {
    try {
      const g = globalThis;
      const store = g && g.__BLEED_STORE__;
      const apiKey = String(req.headers["x-api-key"] || "");
      const tenantId = apiKey ? `t_${apiKey.slice(0, 8)}` : "t_public";

      const temp = String(req.query.temp || "warm").toLowerCase();  // 'hot' | 'warm'
      const region = String(req.query.region || "").toLowerCase();

      let items = [];
      if (store && typeof store.listLeads === "function") {
        items = await store.listLeads(tenantId, { limit: 200 });
      }

      if (region) items = items.filter((l) => (l.region || "").toLowerCase() === region);
      const isHot = (l) => ((l && l.scores && l.scores.intent) || 0) >= 0.7;
      items = temp === "hot" ? items.filter(isHot) : items.filter((l) => !isHot(l));

      console.log(`[public] GET /leads -> 200 temp=${temp} region=${region || "-"} count=${items.length}`);
      res.status(200).json({ ok: true, items, count: items.length });
    } catch (err) {
      console.error("[public] /leads error", err);
      // keep lenient so the panel doesn't break
      res.status(200).json({ ok: true, items: [], count: 0 });
    }
  });

  app.use("/api/v1", r);
  console.log("[routes] mounted public from ./routes/public");
  return r;
}
