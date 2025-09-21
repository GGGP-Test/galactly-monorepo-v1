// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import quota, { resetQuota, snapshotQuota } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Legacy list endpoint stub (keeps panel from 404-ing)
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, items: [], warm: [], hot: [] });
});

// --- Middleware: burst RL + daily quota
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 tries / 10s
const q = quota({
  limits: {
    free: { totalPerDay: 3, hotPerDay: 1, burstPerMin: 4, cooldownSec: 60 },
    pro:  { totalPerDay: 200, hotPerDay: 9999, burstPerMin: 60, cooldownSec: 5 },
  },
});

// Canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", rl, q, findBuyers);

// Extra aliases to be bulletproof
app.post("/find-buyers", rl, q, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.get("/find-buyers", rl, q, findBuyers);

// --- Dev/test admin (only when explicitly enabled)
const ALLOW_TEST = process.env.ALLOW_TEST === "1";
if (ALLOW_TEST) {
  const check = (req: Request) => {
    const token = (req.headers["x-admin-token"] as string | undefined) || "";
    const expect = process.env.ADMIN_TOKEN || "dev";
    return token === expect;
  };

  app.post("/__admin/reset-quota", (req: Request, res: Response) => {
    if (!check(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const key = (req.body && (req.body.key as string)) || undefined;
    const n = resetQuota(key);
    res.json({ ok: true, cleared: n, key: key ?? "*" });
  });

  app.get("/__admin/quota", (req: Request, res: Response) => {
    if (!check(req)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    res.json({ ok: true, usage: snapshotQuota() });
  });
}

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