import express from "express";
import cors from "cors";
import morgan from "morgan";
import metricsRouter, { metricsRouter as namedMetricsRouter } from "./routes/metrics";

// Some platforms inject PORT; fall back to 8787 to match Dockerfile EXPOSE
const PORT = Number(process.env.PORT || 8787);

const app = express();

// --- core middleware ---
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));

// --- health ---
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

/**
 * Metrics/FOMO endpoints
 * We support both default and named import to avoid future import/export mismatches.
 * Mount at /api/v1/metrics
 */
app.use("/api/v1/metrics", metricsRouter ?? namedMetricsRouter);

// NOTE: keep your existing routers mounted below (buyers, leads, auth, etc.)
// Example (do NOT add if you already mount these elsewhere):
// import buyersRouter from "./routes/buyers";
// app.use("/api/v1/leads", buyersRouter);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${PORT}`);
});