import express from "express";
import cors from "cors";

import leadsRouter from "./routes/leads";
import { metricsRouter } from "./routes/metrics";

const app = express();

// ---- CORS (allow list from env) ----
const allow = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // no Origin (e.g. curl) -> allow
      if (!origin) return cb(null, true);
      if (allow.length === 0) return cb(null, true);
      if (allow.includes(origin)) return cb(null, true);
      return cb(null, false as any);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- health ----
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// ---- API ----
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// ---- error handler ----
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server:error]", err?.stack || err?.message || String(err));
    res.status(500).json({ ok: false, error: "internal" });
  }
);

const PORT = Number(process.env.PORT || 8787);

// only start listener when run directly (Docker runs dist/index.js)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`API listening on :${PORT}`);
  });
}

export default app;