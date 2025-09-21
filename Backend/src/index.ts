import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";
import { quota, configureQuota, resetQuota, snapshotQuota, setPlanForApiKey } from "./middleware/quota";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- boot-time quota config (one place, no more per-route changes) ----
const INTERNAL_KEYS = (process.env.INTERNAL_API_KEYS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

configureQuota({
  limits: {
    // your current ask: free users can make 3 requests/day to find buyers
    free: { dailyTotal: 3, cooldownSec: 600 },
    pro: { dailyTotal: 250, cooldownSec: 30 },
    internal: { dailyTotal: 1_000_000 },
  },
  internalKeys: INTERNAL_KEYS,
  disabled: process.env.QUOTA_DISABLED === "true",
});

// Optionally promote keys via env (comma pairs key:plan)
const PROMOTE = (process.env.PROMOTE_KEYS || "") // e.g. "abc123:pro,xyz:internal"
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
for (const pair of PROMOTE) {
  const [k, p] = pair.split(":");
  if (k && p && (["free", "pro", "internal"] as const).includes(p as any)) {
    setPlanForApiKey(k, p as any);
  }
}

// ---- health ----
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// ---- stub warm/hot list so the panel never 404s ----
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({ temp, region: req.query.region ?? null, warm: [], hot: [], items: [] });
});

// ---- main endpoint (rate limit + quota + handler) ----
const rl = rateLimit({ windowMs: 10_000, max: 4 }); // 4 calls/10s per API key/ip (your current setting)
app.post("/api/v1/leads/find-buyers", rl, quota(), findBuyers);

// extra aliases (GET & short path) for resilience
app.get("/api/v1/leads/find-buyers", rl, quota(), findBuyers);
app.post("/find-buyers", rl, quota(), findBuyers);
app.get("/find-buyers", rl, quota(), findBuyers);

// ---- tiny admin endpoints (auth = internal key via x-api-key) ----
function requireInternal(req: Request, res: Response, next: NextFunction) {
  const k = String(req.header("x-api-key") || "");
  if (!INTERNAL_KEYS.includes(k)) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  return next();
}

app.post("/__admin/quota/reset", requireInternal, (req, res) => {
  const k = typeof req.query.key === "string" ? req.query.key : undefined;
  resetQuota(k);
  res.json({ ok: true });
});

app.get("/__admin/quota/snapshot", requireInternal, (_req, res) => {
  res.json({ ok: true, rows: snapshotQuota() });
});

// ---- 404 + error handler ----
app.use((req, res) => {
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