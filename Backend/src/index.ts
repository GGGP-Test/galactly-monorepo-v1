// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, configureQuota, setPlanForApiKey } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// --- Read-only stub for list so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    items: [], // keeping schema stable
  });
});

// --- Rate limit: 4 calls per 10s per IP/API key (front-end already handles back-off)
const rl = rateLimit({ windowMs: 10_000, max: 4 });

// --- Quota: daily credit buckets by plan
configureQuota({
  windowDays: 1,
  limits: {
    free: { dailyRequests: 3 },      // Free plan: 3 "find-buyers" calls per day
    pro: { dailyRequests: 10_000 },  // Pro plan: effectively uncapped
    internal: { dailyRequests: Number.MAX_SAFE_INTEGER }, // bypass
  },
});

// Optional: pre-load test/pro keys from env (comma-separated)
for (const k of (process.env.TEST_API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean)) {
  setPlanForApiKey(k, "internal");
}
for (const k of (process.env.PRO_API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean)) {
  setPlanForApiKey(k, "pro");
}

const q = quota();

// --- Find buyers endpoints (rl -> quota -> handler)
app.post("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.post("/find-buyers", rl, q, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.get("/find-buyers", rl, q, findBuyers);

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