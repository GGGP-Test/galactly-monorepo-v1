// src/index.ts
// Express bootstrap with strict CORS, tiny logger, and canonical /api/* mounts.

import express, { Request, Response, NextFunction } from "express";

import HealthRouter from "./routes/health";
import PrefsRouter from "./routes/prefs";
import LeadsRouter from "./routes/leads";
import CatalogRouter from "./routes/catalog";
import PlacesRouter from "./routes/places";
import ClassifyRouter from "./routes/classify";
import { CFG, isOriginAllowed } from "./shared/env";

const app = express();

// ---- basic hardening --------------------------------------------------------
app.disable("x-powered-by");

// ---- tiny logger ------------------------------------------------------------
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const dtMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    // keep logs compact; Northflank groups nicely
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${dtMs}ms`
    );
  });
  next();
});

// ---- strict CORS (no deps) --------------------------------------------------
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin as string | undefined;
  res.setHeader("Vary", "Origin");
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    const reqHdrs =
      (req.headers["access-control-request-headers"] as string | undefined) ||
      "Content-Type,Authorization";
    res.setHeader("Access-Control-Allow-Headers", reqHdrs);
    return res.status(204).end();
  }
  next();
});

// ---- body parsing -----------------------------------------------------------
app.use(express.json({ limit: "512kb" }));

// ---- health probes ----------------------------------------------------------
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.use("/api/health", HealthRouter);

// ---- API mounts (canonical only) -------------------------------------------
app.use("/api/prefs", PrefsRouter);
app.use("/api/leads", LeadsRouter);
app.use("/api/catalog", CatalogRouter);
app.use("/api/places", PlacesRouter);
app.use("/api/classify", ClassifyRouter); // fixes 404 seen from the modal

// ---- 404 for unknown /api/* -------------------------------------------------
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// ---- generic error handler --------------------------------------------------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", (err as any)?.message || err);
  res.status(500).json({ ok: false, error: "server_error" });
});

// ---- boot -------------------------------------------------------------------
const port = Number(CFG.port || process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`buyers-api listening on :${port} (env=${CFG.nodeEnv}) — /healthz, /api/*`);
});

export default app;