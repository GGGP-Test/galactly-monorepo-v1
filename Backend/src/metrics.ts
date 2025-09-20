import { Request, Response, NextFunction } from "express";

type Num = number;
const MAX_SAMPLES = 200; // keep last N latencies in memory

const state = {
  requestCount: 0,
  findBuyers: {
    count: 0,
    cacheHit: 0,
    cacheMiss: 0,
    latencies: [] as Num[],
  },
};

function recordLatency(ms: number) {
  const arr = state.findBuyers.latencies;
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

function pct(arr: Num[], p: Num) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const t0 = Date.now();
  state.requestCount += 1;

  // Patch res.json so we can see the response payload & timing.
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    const ms = Date.now() - t0;

    if (req.path.endsWith("/find-buyers")) {
      state.findBuyers.count += 1;
      recordLatency(ms);
      const cache = body && typeof body === "object" ? (body as any).cache : undefined;
      if (cache === "hit") state.findBuyers.cacheHit += 1;
      else if (cache === "miss") state.findBuyers.cacheMiss += 1;
    }

    return originalJson(body);
  };

  next();
}

export function metricsHandler(_req: Request, res: Response) {
  const lats = state.findBuyers.latencies;
  const sum = lats.reduce((a, b) => a + b, 0);
  const avg = lats.length ? Math.round((sum / lats.length) * 10) / 10 : 0;

  res.status(200).json({
    ok: true,
    requests: state.requestCount,
    findBuyers: {
      count: state.findBuyers.count,
      cache: {
        hit: state.findBuyers.cacheHit,
        miss: state.findBuyers.cacheMiss,
      },
      latencyMs: {
        avg,
        p50: pct(lats, 50),
        p90: pct(lats, 90),
        p95: pct(lats, 95),
        p99: pct(lats, 99),
        last: lats[lats.length - 1] ?? 0,
        samples: lats.length,
      },
    },
    now: new Date().toISOString(),
  });
}