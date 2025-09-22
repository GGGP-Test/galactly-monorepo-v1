import express from "express";
import cors from "cors";

// Routers
import leadsRouter from "./routes/leads";
import { metricsRouter } from "./routes/metrics";

// ---- app ----
const app = express();

// Trust proxy if running behind a proxy (Fly, Render, etc.)
app.set("trust proxy", 1);

// JSON + urlencoded
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS — allow GitHub Pages and any comma-separated origins in CORS_ORIGIN
const originsEnv = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
const defaultOrigins = [
  "https://gggp-test.github.io",
  "https://gggp-test.github.io/galactly-monorepo-v1"
];
const allowList = [...new Set([...defaultOrigins, ...originsEnv])];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // allow curl/postman
      if (allowList.some(o => origin.startsWith(o))) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Api-Key", "x-api-key"],
  })
);

// quick preflight
app.options("*", cors());

// Health
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// API v1
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// ---- boot ----
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}`);
});