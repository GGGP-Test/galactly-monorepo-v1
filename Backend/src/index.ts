// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, configureQuota } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- health
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// ---- quota config from env (single place, no guessing)
configureQuota({
  windowDays: Number(process.env.QUOTA_WINDOW_DAYS || "1"),
  limits: {
    free:     { daily: Number(process.env.FREE_DAILY || "3") },
    pro:      { daily: Number(process.env.PRO_DAILY || "25") },
    test:     { daily: Number(process.env.TEST_DAILY || "100") },
    internal: { daily: Number(process.env.INT_DAILY || "1000") },
  },
  allowTest: (process.env.ALLOW_TEST || "").toLowerCase() === "true" || process.env.ALLOW_TEST === "1",
  testApiKey: process.env.QUOTA_TEST_API_KEY || undefined,
  disable: (process.env.QUOTA_DISABLE || "").toLowerCase() === "true" || process.env.QUOTA_DISABLE === "1",
});

// ---- stub list endpoint so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    items: [], // empty list until we plug real leads
  });
});

// ---- rate limit (per 10s window) stays in place and is separate from quota
const rl = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || "10000"),
  max: Number(process.env.RATE_LIMIT_MAX || "8"),
});

// ---- find-buyers endpoints (protected by quota + rate limit)
app.post("/api/v1/leads/find-buyers", rl, quota(), findBuyers);

// extra aliases to be bulletproof
app.post("/find-buyers", rl, quota(), findBuyers);
app.get("/api/v1/leads/find-buyers", rl, quota(), findBuyers);
app.get("/find-buyers", rl, quota(), findBuyers);

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