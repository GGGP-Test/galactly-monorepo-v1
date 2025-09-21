// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import quota, { PlanLimits } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Keep the panel list endpoint happy
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, items: [], warm: [], hot: [] });
});

// ---- PLAN CONFIG (tweak here) ----
const PLANS: Record<string, PlanLimits> = {
  free:    { hot: 1,  warm: 2 },     // total=3
  starter: { hot: 6,  warm: 24 },    // total=30
  pro:     { hot: 30, warm: 120 },   // total=150
  scale:   { hot: 120, warm: 480 },  // total=600
};

// Burst limiter (simple, same for all plans for now)
const rl = rateLimit({ windowMs: 10_000, max: 4 });

// Daily quota by plan (read from x-plan header; defaults to "free")
const planQuota = quota({ plans: PLANS });

// ---- Routes (rate limit + quota + handler) ----
app.post("/api/v1/leads/find-buyers", rl, planQuota, findBuyers);
app.post("/find-buyers", rl, planQuota, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, planQuota, findBuyers);
app.get("/find-buyers", rl, planQuota, findBuyers);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;