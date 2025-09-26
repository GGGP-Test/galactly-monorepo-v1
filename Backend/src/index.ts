// src/index.ts
// Express bootstrap with safe CORS, optional tiny logger, and /version.
// Routers are mounted exactly as they are defined (no double-prefixing).

import express, { Request, Response, NextFunction } from "express";
import HealthRouter from "./routes/health";
import CatalogRouter from "./routes/catalog";
import LeadsRouter from "./routes/leads";
import PrefsRouter from "./routes/prefs";

const app = express();

// --- basics ---
app.disable("x-powered-by");
app.use(express.json({ limit: process.env.JSON_LIMIT || "1mb" }));

// --- tiny, dependency-free logger (opt-in) ---
if ((process.env.DEBUG_LOG_REQUESTS || "").trim() === "1") {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const t0 = Date.now();
    const { method, url } = req;
    res.on("finish", () => {
      const ms = Date.now() - t0;
      // keep it short; avoid logging bodies or secrets
      console.log(`[req] ${method} ${url} → ${res.statusCode} ${ms}ms`);
    });
    next();
  });
}

// --- very simple CORS (override with CORS_ALLOW_ORIGIN if needed) ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const allow = process.env.CORS_ALLOW_ORIGIN || "*";
  res.header("Access-Control-Allow-Origin", allow);
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- routes ---
// Health router contains both /health and /api/health
app.use(HealthRouter);

// Catalog router exposes /api/catalog/*
app.use(CatalogRouter);

// Leads router exposes /api/leads/find-buyers
app.use(LeadsRouter);

// Prefs router is a factory that we mount under /api/prefs
app.use("/api/prefs", PrefsRouter());

// Lightweight ping
app.get("/_ping", (_req, res) => res.type("text/plain").send("pong"));

// Build/version info (no external file needed)
app.get("/version", (_req, res) => {
  res.json({
    ok: true,
    service: "buyers-api",
    node: process.version,
    env: process.env.NODE_ENV || "development",
    git: {
      sha: process.env.GIT_SHA || null,
      branch: process.env.GIT_BRANCH || null,
      time: process.env.BUILD_TIME || null,
    },
    nowIso: new Date().toISOString(),
  });
});

// --- start server when run directly ---
const PORT = Number(process.env.PORT || 8787);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[boot] buyers-api listening on :${PORT}`);
  });
}

export default app;