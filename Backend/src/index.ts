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

// List endpoint stub so the panel never 404s
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, items: [], warm: [], hot: [] });
});

// --- middleware: short-burst rate limit + daily quota ---
const burstRL = rateLimit({ windowMs: 10_000, max: 4 }); // 4 clicks / 10s (adjust here)
const dailyQuota = quota({
  windowDays: 1,
  plans: {
    free: { dailyCalls: 3 },   // <= change to 4 if you want
    pro:  { dailyCalls: 200 },
  },
});

// canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", burstRL, dailyQuota, findBuyers);

// aliases to be bulletproof
app.post("/find-buyers", burstRL, dailyQuota, findBuyers);
app.get("/api/v1/leads/find-buyers", burstRL, dailyQuota, findBuyers);
app.get("/find-buyers", burstRL, dailyQuota, findBuyers);

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