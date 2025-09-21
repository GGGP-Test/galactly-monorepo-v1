// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import quota from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Stub the legacy list endpoint so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    warm: [],
    hot: [],
  });
});

// --- Controls ---
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 requests / 10s per API key

// Daily quota: Free = 3 total/day, 1 hot/day; Pro very high
const q = quota({
  windowDays: 1,
  freeTotal: 3,
  freeHot: 1,
  proTotal: 1000,
  proHot: 999,
});

// canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", rl, q, findBuyers);

// extra aliases to be bulletproof
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