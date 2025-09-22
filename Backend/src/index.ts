// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import morgan from "morgan";

import leadsRouter from "./routes/leads";

// ---- metrics import made bulletproof (handles default or named export) ----
import * as MetricsModule from "./routes/metrics";
// Resolve whichever export the file provides without tripping TS named-export checks
const metricsRouter =
  (MetricsModule as any).metricsRouter ||
  (MetricsModule as any).default ||
  (MetricsModule as any).router ||
  null;

// ---------- config ----------
const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || "production";
const ALLOW_WEB = String(process.env.ALLOW_WEB ?? "true").toLowerCase() === "true";
// Comma-separated list, e.g. "https://gggp-test.github.io,https://gggp-test.github.io/galactly-monorepo-v1"
const RAW_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ---------- app ----------
const app = express();
app.set("trust proxy", true);

app.use(express.json({ limit: "1mb" }));
app.use(morgan(NODE_ENV === "production" ? "tiny" : "dev"));

// ---------- CORS ----------
const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (!ALLOW_WEB) return cb(null, false);                 // disable browser access entirely
    if (!origin) return cb(null, true);                     // server-to-server, curl, healthcheck
    if (RAW_ORIGINS.length === 0) return cb(null, true);    // no list provided -> allow all
    const ok = RAW_ORIGINS.some(o => origin === o || origin.endsWith(o));
    return cb(ok ? null : new Error("CORS"), ok);
  },
  credentials: true,
  // Be generous here so preflight never blocks x-api-key casing differences
  allowedHeaders: ["Content-Type", "content-type", "x-api-key", "X-API-KEY"],
  methods: ["GET", "POST", "OPTIONS"]
};
app.use(cors(corsOptions));

// ---------- health ----------
app.get("/", (_req: Request, res: Response) =>
  res.json({ ok: true, service: "buyers-api", env: NODE_ENV, ts: new Date().toISOString() })
);
// Exact path your Dockerfile healthcheck hits:
app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));
// Keep the alternative too
app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));

// ---------- routes ----------
app.use("/api/v1/leads", leadsRouter);

if (metricsRouter) {
  app.use("/api/v1/metrics", metricsRouter);
  console.log("[startup] metrics router mounted");
} else {
  console.warn("[startup] metrics router NOT mounted (no export found in ./routes/metrics)");
}

// ---------- errors ----------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const code = err?.status || 500;
  const msg = err?.message || "internal error";
  if (NODE_ENV !== "production") console.error("[error]", err);
  res.status(code).json({ ok: false, error: msg });
});

app.use((_req: Request, res: Response) =>
  res.status(404).json({ ok: false, error: "not found" })
);

// ---------- start ----------
app.listen(PORT, () => {
  console.log(
    `[buyers-api] listening on :${PORT} (env=${NODE_ENV}) | ALLOW_WEB=${ALLOW_WEB} | CORS_ORIGIN=${RAW_ORIGINS.join(
      ","
    ) || "*"}`
  );
});