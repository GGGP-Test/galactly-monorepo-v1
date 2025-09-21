// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, resetQuota, snapshotQuota, type PlanLimits } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health",  (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Stub the legacy list endpoint so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    items: [],       // give the UI the shape it expects
  });
});

// ---- Limits ----
// Burst protection (4 clicks per 10s)
const rl = rateLimit({ windowMs: 10_000, max: 4 });

// Daily quota (Free = 3/day; Pro big number; Internal unlimited)
const planLimits: Record<"free"|"pro"|"internal", PlanLimits> = {
  free:     { dailyFindBuyers: 3 },
  pro:      { dailyFindBuyers: 1000 },
  internal: { dailyFindBuyers: 100000 },
};
const qmw = quota({
  windowDays: 1,
  plans: planLimits,
  testingBypassKey: process.env.TEST_BYPASS_KEY || "DEV-UNLIMITED",
});

// ---- Find buyers endpoints (guarded by rate limit + quota) ----
app.post("/api/v1/leads/find-buyers", rl, qmw, findBuyers);

// extra aliases to be bulletproof with the panel
app.post("/find-buyers", rl, qmw, findBuyers);
app.get ("/api/v1/leads/find-buyers", rl, qmw, findBuyers);
app.get ("/find-buyers", rl, qmw, findBuyers);

// ---- Minimal debug/admin helpers ----
app.get("/quota", (_req: Request, res: Response) => res.status(200).json(snapshotQuota()));
app.post("/__admin/quota/reset", (_req: Request, res: Response) => { resetQuota(); res.json({ ok: true }); });

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