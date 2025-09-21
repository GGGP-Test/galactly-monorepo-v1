// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, resetQuota, snapshotQuota, setPlanForApiKey } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- health -----------------------------------------------------------------
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// --- legacy list stub so the panel never 404s --------------------------------
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, items: [] });
});

// --- rate limiter (short-burst) ----------------------------------------------
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 clicks per 10s

// --- daily quota gate (plan-aware) -------------------------------------------
const q = quota({
  windowDays: 1,
  freeDaily: 3,          // Free plan: 3/day total
  proDaily: 10_000,      // Pro: effectively unlimited for our scale
  testDaily: 5_000,      // Test/dev: high enough to not get in your way
});

// optional: seed a test API key, so entering this in the panel "API key" box
// immediately grants the "test" plan even when we later turn off anon test.
const TEST_KEY = process.env.QUOTA_TEST_KEY || "TEST_TEST_TEST";
setPlanForApiKey(TEST_KEY, "test");
console.log(`[quota] seeded test key: ${TEST_KEY}`);

// --- canonical routes the panel uses -----------------------------------------
app.post("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.post("/find-buyers", rl, q, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.get("/find-buyers", rl, q, findBuyers);

// --- tiny admin/test endpoints (handy while quotas are on) -------------------
app.post("/_admin/reset-quota", (_req: Request, res: Response) => {
  resetQuota();
  res.json({ ok: true });
});
app.get("/_admin/snapshot-quota", (req: Request, res: Response) => {
  const key = (req.query.key as string) || "";
  res.json({ ok: true, data: snapshotQuota(key) });
});

// --- 404 + error -------------------------------------------------------------
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;