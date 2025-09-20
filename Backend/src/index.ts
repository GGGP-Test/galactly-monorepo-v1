// src/index.ts
import express from "express";
import cors from "cors";
import { findWarmBuyers } from "./services/find-buyers";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Healthcheck (your Dockerfile pings this)
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---- Handlers ----
const findBuyersHandler = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const b = (req.body ?? {}) as {
      supplier?: string; region?: string; radiusMiles?: number | string; personaTitles?: string[]; pro?: boolean;
    };
    if (!b.supplier) return res.status(400).json({ error: "BadRequest", message: "Missing 'supplier'" });

    const input = {
      supplier: String(b.supplier),
      region: (b.region ?? "US/CA") as string,
      radiusMiles: Number(b.radiusMiles ?? 50),
      personaTitles: Array.isArray(b.personaTitles) ? b.personaTitles : [],
      pro: Boolean(b.pro),
    };

    const result = await findWarmBuyers(input);
    res.json(result ?? { hot: [], warm: [], notes: [] });
  } catch (err) {
    next(err);
  }
};

// Route aliases so the panel works even if a proxy adds prefixes
app.post("/find-buyers", findBuyersHandler);
app.post("/api/find-buyers", findBuyersHandler);
app.post("/api/v1/find-buyers", findBuyersHandler);
app.post("/buyers/find", findBuyersHandler);

// Stub for the panel’s Hot/Warm refresh list (returns empty for now)
const leadsStub = (_req: express.Request, res: express.Response) => res.json({ items: [], next: null });
app.get("/api/v1/leads", leadsStub);
app.get("/api/leads", leadsStub);
app.get("/leads", leadsStub);

// Debug: see which routes are live
app.get("/_debug", (_req, res) =>
  res.json({ ok: true, routes: ["/find-buyers","/api/find-buyers","/api/v1/find-buyers","/buyers/find","/api/v1/leads"] })
);

// 404 + error handlers
app.use((req, res) => res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path }));
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[buyers-api] error:", err);
  res.status(500).json({ error: "INTERNAL", message: err?.message ?? "unknown" });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`[buyers-api] listening on ${port}`));