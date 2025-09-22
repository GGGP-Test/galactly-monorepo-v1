// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";

import leadsRouter from "./routes/leads";

// -------- Optional request logging (no hard dependency on morgan) --------
function buildLogger(env: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const morgan = require("morgan");
    return morgan(env === "production" ? "tiny" : "dev");
  } catch {
    // Fallback: no-op middleware so prod doesn't need morgan installed
    console.warn("[startup] morgan not installed; continuing without request logging");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
}

// -------- Bulletproof import for metrics router (default or named export) --------
import * as MetricsModule from "./routes/metrics";
const metricsRouter =
  (MetricsModule as any).metricsRouter ||
  (MetricsModule as any).default ||
  (MetricsModule as any).router ||
  null;

// ------------------------ Config ------------------------
const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || "production";
const ALLOW_WEB = String(process.env.ALLOW_WEB ?? "true").toLowerCase() === "true";
// Comma-separated list of allowed origins, e.g. "https://gggp-test.github.io,https://gggp-test.github.io/galactly-monorepo-v1"
const RAW_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ------------------------ App ------------------------
const app = express();
app.set("trust proxy", true);

app.use(express.json({ limit: "1mb" }));
app.use(buildLogger(NODE_ENV));

// ------------------------ CORS ------------------------
const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (!ALLOW_WEB) return cb(null, false);
    if (!origin) return cb(null, true); // curl/healthchecks/server-to-server
    if (RAW_ORIGINS.length === 0) return cb(null, true); // allow all if none configured
    const ok = RAW_ORIGINS.some(o => origin === o || origin.endsWith(o));
    return cb(ok ? null : new Error("CORS"), ok);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  // allow both cases so preflight never blocks
  allowedHeaders: ["Content-Type", "content-type", "x-api-key", "X-API-KEY"]
};
app.use(cors(corsOptions));

// ------------------------ Health ------------------------
app.get("/", (_req, res) =>
  res.json({ ok: true, service: "buyers-api", env: NODE_ENV, ts: new Date().toISOString() })
);
// Your Dockerfile probes /health — keep this exact path:
app.get("/health", (_req, res) => res.json({ ok: true }));
// Alternate for humans/other tooling:
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ------------------------ Routes ------------------------
app.use("/api/v1/leads", leadsRouter);

if (metricsRouter) {
  app.use("/api/v1/metrics", metricsRouter);
  console.log("[startup] metrics router mounted");
} else {
  console.warn("[startup] metrics router NOT mounted (no export found in ./routes/metrics)");
}

// ------------------------ Errors ------------------------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status || 500;
  const message = err?.message || "internal error";
  if (NODE_ENV !== "production") console.error("[error]", err);
  res.status(status).json({ ok: false, error: message });
});

app.use((_req: Request, res: Response) => res.status(404).json({ ok: false, error: "not found" }));

// ------------------------ Start ------------------------
app.listen(PORT, () => {
  console.log(
    `[buyers-api] listening on :${PORT} (env=${NODE_ENV}) | ALLOW_WEB=${ALLOW_WEB} | CORS_ORIGIN=${RAW_ORIGINS.join(
      ","
    ) || "*"}`
  );
});