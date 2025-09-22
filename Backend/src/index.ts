import express from "express";
import cors from "cors";

import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics";

const app = express();

// ---- JSON body parsing ----
app.use(express.json({ limit: "2mb" }));

// ---- CORS ----
const rawOrigins = (process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || "").trim();
const allowAll = !rawOrigins;
const originList = rawOrigins
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowAll ? true : (origin, cb) => {
      if (!origin) return cb(null, true); // allow same-origin / curl
      const ok = originList.some(o => origin === o || origin.startsWith(o));
      cb(null, ok);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "x-api-key".toUpperCase()],
  })
);

// ---- Health ----
app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- API routes ----
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// ---- 404 fallback ----
app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));

// ---- Error handler ----
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[server:error]", err?.stack || err?.message || err);
  res.status(500).json({ ok: false, error: "internal error" });
});

// ---- Start ----
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});