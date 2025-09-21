// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import quota, { setPlanForApiKey } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Health
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health",  (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// --- Demo list endpoint (keeps the panel happy on first load)
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, items: [] });
});

// --- Rate limit (short burst protection for the “Find buyers” button)
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 requests per 10s, then auto-cooldown via rateLimit.ts

// --- Daily quota by plan (FREE/PRO/INTERNAL)
const qmw = quota(); // uses env or defaults (free: 3/day)

// Optional: map a specific API key to a higher plan without changing types
const TEST_KEY = process.env.TEST_API_KEY || process.env.GG_TEST_KEY || "";
if (TEST_KEY) setPlanForApiKey(TEST_KEY, "internal");

// Canonical route used by the panel
app.post("/api/v1/leads/find-buyers", rl, qmw, findBuyers);

// Extra aliases (keep them gated too)
app.post("/find-buyers", rl, qmw, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, qmw, findBuyers);
app.get("/find-buyers", rl, qmw, findBuyers);

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;