// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

// NOTE: these modules already existed in your repo
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";

// NEW quota middleware (default export + helpers)
import quota, { configureQuota } from "./middleware/quota";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- health ---
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// --- configure quotas safely from env (no code edits needed later) ---
const FREE_DAILY = Number(process.env.FREE_DAILY || "3");          // you asked: 3/day on free
const PRO_DAILY  = Number(process.env.PRO_DAILY  || "1000");       // generous default
const TEST_DAILY = Number(process.env.TEST_DAILY || "10000");      // testing keys
const INT_DAILY  = Number(process.env.INT_DAILY  || "1000000");    // internal keys
const QUOTA_DAYS = Number(process.env.QUOTA_WINDOW_DAYS || "1");

configureQuota({
  windowDays: QUOTA_DAYS,
  limits: {
    free: { dailyFindBuyers: FREE_DAILY },
    pro:  { dailyFindBuyers: PRO_DAILY  },
    test: { dailyFindBuyers: TEST_DAILY },
    internal: { dailyFindBuyers: INT_DAILY }
  }
});

// --- stub legacy list endpoint so the panel never 404s ---
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp =
    req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    items: [], // keep shape consistent for the panel
  });
});

// --- rate limit (per 10s), then quota (per day) ---
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 tries / 10s as you set
const q  = quota();

// canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", rl, q, findBuyers);

// extra aliases to be bulletproof with older panels
app.post("/find-buyers", rl, q, findBuyers);
app.get("/api/v1/leads/find-buyers", rl, q, findBuyers);
app.get("/find-buyers", rl, q, findBuyers);

// --- 404 ---
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

// --- error handler ---
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;
