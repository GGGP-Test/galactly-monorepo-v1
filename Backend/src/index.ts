import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors from "cors";
import findBuyers from "./services/find-buyers";

// ----------------- app bootstrap -----------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ----------------- health -----------------
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/health", (_req: Request, res: Response) => res.status(200).json({ ok: true }));

// Silence browser favicon noise (was a 404 in Network tab)
app.get("/favicon.ico", (_req: Request, res: Response) => res.status(204).end());

// ----------------- minimal metrics -----------------
type Lat = { avg: number; p50: number; p90: number; p95: number; p99: number; last: number; samples: number };
const latencies: number[] = [];
const cache = { hit: 0, miss: 0 };
let totalRequests = 0;
let findBuyersCount = 0;

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}
function computeLat(): Lat {
  const n = latencies.length;
  const avg = n ? Math.round(latencies.reduce((a, b) => a + b, 0) / n) : 0;
  return {
    avg,
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    last: n ? latencies[n - 1] : 0,
    samples: n,
  };
}

// count every request (cheap)
app.use((_req, _res, next) => {
  totalRequests += 1;
  next();
});

// Wrap a handler to record latency + cache header
const withMetrics = (h: RequestHandler): RequestHandler => {
  return (req, res, next) => {
    const t0 = Date.now();
    res.once("finish", () => {
      const ms = Date.now() - t0;
      if (req.method === "POST" && req.path.endsWith("/find-buyers")) {
        findBuyersCount += 1;
        latencies.push(ms);
        if (latencies.length > 200) latencies.shift(); // simple cap

        // try to read X-Cache the handler may set (HIT/MISS)
        const headers = res.getHeaders?.() ?? {};
        const xCache =
          (res.getHeader && (res.getHeader("X-Cache") as string | undefined)) ||
          (typeof headers["x-cache"] === "string" ? (headers["x-cache"] as string) : undefined);

        if (typeof xCache === "string") {
          const v = xCache.toLowerCase();
          if (v.includes("hit")) cache.hit += 1;
          else if (v.includes("miss")) cache.miss += 1;
        }
      }
    });
    h(req, res, next);
  };
};

// ----------------- API routes -----------------

// Legacy list endpoint the panel pings for warm/hot; keep UI happy.
app.get("/api/v1/leads", (req: Request, res: Response) => {
  const temp = req.query.temp === "hot" ? "hot" : "warm";
  res.status(200).json({
    temp,
    region: req.query.region ?? null,
    warm: [],
    hot: [],
  });
});

// Canonical route used by the Free Panel
app.post("/api/v1/leads/find-buyers", withMetrics(findBuyers));

// Accept both spellings + both verbs for compatibility
app.post("/find-buyers", withMetrics(findBuyers));
app.get("/api/v1/leads/find-buyers", withMetrics(findBuyers));
app.get("/find-buyers", withMetrics(findBuyers));

// Metrics snapshot (cheap and human-checkable)
app.get("/metrics", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    requests: totalRequests,
    findBuyers: {
      count: findBuyersCount,
      cache,
      latencyMs: computeLat(),
    },
    now: new Date().toISOString(),
  });
});

// ----------------- 404 + error handling -----------------
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "NOT_FOUND", method: req.method, path: req.path });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const any = err as { status?: number; message?: string };
  const status = typeof any?.status === "number" ? any.status : 500;
  const message = any?.message ?? "Internal Server Error";
  res.status(status).json({ error: "INTERNAL_ERROR", message });
});

// ----------------- listen -----------------
const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;