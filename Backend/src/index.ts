import express from "express";
import cors from "cors";

// Routers
import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics"; // default import to avoid named-export mismatch

// ----- app -----
const app = express();

// trust proxy (if behind a proxy/load balancer)
if (process.env.TRUST_PROXY) app.set("trust proxy", true);

// body parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// -------- CORS (allow GitHub Pages + your custom origins) --------
const originsEnv = (process.env.CORS_ORIGIN || "").trim();
// support comma- or space-separated list
const allowed = originsEnv
  ? originsEnv.split(/[,\s]+/).filter(Boolean)
  : ["*"]; // permissive if not set

const corsOptions: cors.CorsOptions = {
  origin: function (origin, cb) {
    // allow same-origin / server-to-server / curl (no origin header)
    if (!origin) return cb(null, true);
    if (allowed.includes("*")) return cb(null, true);
    // exact match or startsWith match for convenience
    const ok = allowed.some((o) => origin === o || origin.startsWith(o));
    cb(ok ? null : new Error("CORS blocked"), ok);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  maxAge: 3600,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // handle preflights

// ----- health -----
app.get("/healthz", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ----- api -----
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// root (optional)
app.get("/", (_req, res) => res.json({ ok: true }));

// ----- start -----
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on :${PORT}`);
});

export default app;