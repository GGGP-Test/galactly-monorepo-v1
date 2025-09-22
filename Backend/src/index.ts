// src/index.ts
import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics";

const app = express();
const PORT = process.env.PORT || 8787;

// CORS — allow your GitHub Pages origin(s)
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.length === 0) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
    allowedHeaders: ["Content-Type", "X-Api-Key", "x-api-key"],
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "512kb" }));

// Health
app.get("/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// Mount API
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// Fallback JSON 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));

app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});