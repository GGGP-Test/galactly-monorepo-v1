// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";
import rateLimit from "./middleware/rateLimit";

// --------------------
// tiny in-process metrics (what you already expose)
const metrics = {
  requests: 0,
  findBuyers: {
    count: 0,
    cache: { hit: 0, miss: 0 },
    latencyMs: { samples: 0, last: 0, p50: 0, p90: 0, p95: 0, p99: 0, avg: 0 },
  },
};

function observeLatency(ms: number) {
  const m = metrics.findBuyers.latencyMs;
  m.samples += 1;
  m.last = ms;
  // cheap rolling avg
  m.avg = m.avg + (ms - m.avg) / m.samples;
  // for demo we just push into a tiny array to compute rough percentiles
  // without adding a dependency
  (observeLatency as any)._buf = (observeLatency as any)._buf ?? [];
  const buf: number[] = (observeLatency as any)._buf;
  buf.push(ms);
  while (buf.length > 200) buf.shift();
  const sorted = [...buf].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
  m.p50 = q(50);
  m.p90 = q(90);
  m.p95 = q(95);
  m.p99 = q(99);
}
// --------------------

const app = express();

// CORS + JSON
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Request ID + simple access log
app.use((req, res, next) => {
  const id = Math.random().toString(36).slice(2, 10);
  (res as any).locals = { ...(res as any).locals, reqId: id, t0: Date.now() };
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    const t0 = (res as any).locals?.t0 ?? Date.now();
    const ms = Date.now() - t0;
    // terse, single-line JSON log (stdout)
    console.log(
      JSON.stringify({
        evt: "req",
        id,
        m: req.method,
        p: req.originalUrl,
        s: res.statusCode,
        ms,
      })
    );
  });
  next();
});

// Rate limit (per API key or IP)
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000"); // 60s
const MAX_REQS  = Number(process.env.RATE_LIMIT_MAX ?? "120");        // 120/min
app.use(
  rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_REQS,
    key: (req) => req.get("x-api-key") ?? req.ip,
  })
);

// Health
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health",  (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Legacy list endpoint stub (keeps the panel happy)
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp =
    req.query.temp === "hot" || req.query.temp === "warm" ? String(req.query.temp) : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    warm: [],
    hot: [],
  });
});

// Find buyers with metrics wrapper
app.post("/api/v1/leads/find-buyers", (req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  // decorate res.json to peek at `cache` field if handler sets it
  const json = res.json.bind(res);
  (res as any).json = (body: any) => {
    const ms = Date.now() - t0;
    metrics.requests += 1;
    metrics.findBuyers.count += 1;
    const cache = (body && body.cache) as "hit" | "miss" | undefined;
    if (cache === "hit") metrics.findBuyers.cache.hit += 1;
    else if (cache === "miss") metrics.findBuyers.cache.miss += 1;
    observeLatency(ms);
    return json(body);
  };
  return (findBuyers as any)(req, res, next);
});

// Accept both verbs and short path (backward compat)
app.get ("/api/v1/leads/find-buyers", findBuyers);
app.post("/find-buyers", findBuyers);
app.get ("/find-buyers",  findBuyers);

// Metrics
app.get("/metrics", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    requests: metrics.requests,
    findBuyers: {
      count: metrics.findBuyers.count,
      cache: metrics.findBuyers.cache,
      latencyMs: metrics.findBuyers.latencyMs,
    },
    now: new Date().toISOString(),
  });
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
