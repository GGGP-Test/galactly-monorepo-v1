// src/index.ts
import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics";

const app = express();
app.set("trust proxy", true);

// CORS: read from env or allow the GitHub Pages origin(s) you use
const originsEnv = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || "*";
const allowList = originsEnv.split(",").map(s => s.trim()).filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowList.includes("*")) return cb(null, true);
    const ok = allowList.some((o) => origin?.startsWith(o));
    return cb(null, ok);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// global health
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// api
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// 404 fallback
app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`buyers-api listening on :${port}`);
});