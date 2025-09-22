import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
import { metricsRouter } from "./routes/metrics";

const app = express();

// JSON
app.use(express.json({ limit: "512kb" }));

// CORS (env allows list, comma-separated; defaults to GH pages)
const allow = (process.env.CORS_ORIGIN || "https://gggp-test.github.io,https://gggp-test.github.io/galactly-monorepo-v1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allow,
    credentials: false,
    allowedHeaders: ["Content-Type", "x-api-key"],
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);

// mount routers
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// health
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));

// start (Northflank uses CMD node dist/index.js, so export)
const PORT = Number(process.env.PORT || process.env.NODE_PORT || 8787);
app.listen(PORT, () => {
  console.log(`[buyers-api] listening on ${PORT}`);
});