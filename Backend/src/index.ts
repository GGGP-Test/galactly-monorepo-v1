// src/index.ts
import express from "express";
import LeadsRouter from "./routes/leads";
import PrefsRouter from "./routes/prefs";
import CatalogRouter from "./routes/catalog";
import HealthRouter from "./routes/health";

const app = express();

// Hardening / base middleware
app.disable("x-powered-by");
app.set("trust proxy", (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") ? 1 : false);
app.use(express.json({ limit: "1mb" }));

// Optional request logging (safe even if 'morgan' is not installed)
try {
  // @ts-ignore - dynamic require to avoid hard dependency
  const morgan = require("morgan");
  if (morgan && process.env.REQUEST_LOG !== "0") {
    app.use(morgan(process.env.MORGAN_FORMAT || "tiny"));
  }
} catch {
  // morgan not installed — skip logging without failing
}

// Routers
app.use(LeadsRouter);
app.use("/api/prefs", PrefsRouter());
app.use(CatalogRouter);
app.use(HealthRouter);

// Minimal inline version endpoint (no new file)
app.get(["/version", "/api/version"], (_req, res) => {
  res.json({
    ok: true,
    service: "buyers-api",
    node: process.version,
    env: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 8787),
    commit: process.env.GIT_SHA || undefined,
    branch: process.env.GIT_BRANCH || undefined,
    buildTime: process.env.BUILD_TIME || undefined,
    uptimeSec: Math.round(process.uptime()),
    nowIso: new Date().toISOString(),
  });
});

const PORT = Number(process.env.PORT || 8787);

// Only listen when executed as the entrypoint (keeps tests/imports happy)
if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[buyers-api] listening on :${PORT}`);
  });
}

export default app;