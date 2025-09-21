// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, snapshotQuota, resetQuota, setPlanForApiKey } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health",  (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// --- Legacy list endpoint (keep UI happy) ---
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    items: [],   // UI expects .items for CSV / renders; empty for now
    warm: [],
    hot: [],
  });
});

// --- Abuse controls ---
// 1) short-burst rate limit (4 requests / 10s per IP or key)
const rl = rateLimit({ windowMs: 10_000, max: 4 });

// 2) daily quota (3 requests per day for FREE unless overridden)
const qDaily = quota({ windowDays: 1, freeDaily: 3 });

// --- Buyer finder endpoints ---
app.post("/api/v1/leads/find-buyers", rl, qDaily, findBuyers);
app.post("/find-buyers",                 rl, qDaily, findBuyers);
app.get ("/api/v1/leads/find-buyers",    rl, qDaily, findBuyers);
app.get ("/find-buyers",                 rl, qDaily, findBuyers);

// --- Small ops/diagnostics (keep) ---
app.get("/metrics", (_req: Request, res: Response) => res.status(200).json(snapshotQuota()));
app.post("/_internal/reset-quota", (_req: Request, res: Response) => { resetQuota(); res.json({ ok: true }); });
app.post("/_internal/set-plan", (req: Request, res: Response) => {
  const { apiKey, plan } = (req.body || {}) as { apiKey?: string; plan?: "free" | "pro" | "internal" };
  if (!apiKey || !plan) return res.status(400).json({ ok: false, error: "MISSING_PARAMS" });
  setPlanForApiKey(apiKey, plan);
  res.json({ ok: true });
});

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