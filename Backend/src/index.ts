// src/index.ts
import express from "express";
import cors from "cors";

import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics";

const app = express();

// ---- CORS (allow GH Pages & any extra comma-separated origins in CORS_ORIGIN)
const parseOrigins = (v?: string) =>
  (v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

const GH_PAGES = [
  "https://gggp-test.github.io",
  "https://gggp-test.github.io/galactly-monorepo-v1"
];

const extra = parseOrigins(process.env.CORS_ORIGIN);
const allowList = new Set<string>([...GH_PAGES, ...extra]);

const corsOpts: cors.CorsOptions = {
  origin: (origin, cb) => {
    // Allow same-origin / server-to-server / curl (no Origin header)
    if (!origin) return cb(null, true);
    if (allowList.has(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 600
};

app.use(cors(corsOpts));
app.options("*", cors(corsOpts));

// ---- basics
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// ---- health
app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- API
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// ---- 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// ---- error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = typeof err?.message === "string" ? err.message : "server error";
  // For CORS origin denials, return 403 with a small JSON
  if (msg.startsWith("CORS:")) {
    return res.status(403).json({ ok: false, error: msg });
  }
  console.error("[server:error]", err?.stack || err);
  res.status(500).json({ ok: false, error: msg });
});

const PORT = parseInt(process.env.PORT || "8787", 10);
app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT}`);
});