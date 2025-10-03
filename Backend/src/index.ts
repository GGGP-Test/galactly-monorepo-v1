// src/index.ts
// Express bootstrap with strict CORS, tiny logger, canonical /api/* mounts,
// plus /ping endpoints and a root alias for /classify (to satisfy the modal’s
// fallback). Metrics logic stays in routes/classify.ts.

import express, { Request, Response, NextFunction } from "express";
import * as path from "path";

import HealthRouter from "./routes/health";
import PrefsRouter from "./routes/prefs";
import LeadsRouter from "./routes/leads";
import CatalogRouter from "./routes/catalog";
import PlacesRouter from "./routes/places";
import ClassifyRouter from "./routes/classify";
import BuyersRouter from "./routes/buyers";
import EventsRouter from "./routes/events";
import AuditRouter from "./routes/audit";

import { CFG, isOriginAllowed } from "./shared/env";

const app = express();

/* -------------------------------------------------------------------------- */
/* Basic hardening                                                            */
/* -------------------------------------------------------------------------- */
app.disable("x-powered-by");
app.set("trust proxy", true); // keep client IPs correct when behind a proxy

/* -------------------------------------------------------------------------- */
/* Tiny request logger                                                        */
/* -------------------------------------------------------------------------- */
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const dtMs = Number((process.hrtime.bigint() - t0) / BigInt(1e6));
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${dtMs}ms`
    );
  });
  next();
});

/* -------------------------------------------------------------------------- */
/* Strict CORS (env-driven allowlist)                                         */
/* -------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------- */
/* Body parsing                                                               */
/* -------------------------------------------------------------------------- */
app.use(express.json({ limit: "512kb" }));

/* -------------------------------------------------------------------------- */
/* Health & Ping (used by the modal’s API auto-detection)                     */
/* -------------------------------------------------------------------------- */
const okText = (_req: Request, res: Response) => res.type("text/plain").send("ok");
app.get("/healthz", okText);
app.get("/ping", okText);
app.head("/ping", okText);
app.get("/api/ping", okText);
app.head("/api/ping", okText);

/* -------------------------------------------------------------------------- */
/* Canonical API mounts                                                       */
/* -------------------------------------------------------------------------- */
app.use("/api/health", HealthRouter);
app.use("/api/prefs", PrefsRouter);
app.use("/api/leads", LeadsRouter);
app.use("/api/catalog", CatalogRouter);
app.use("/api/places", PlacesRouter);
app.use("/api/classify", ClassifyRouter);
app.use("/api/buyers", BuyersRouter);
app.use("/api/events", EventsRouter);
app.use("/api/audit", AuditRouter);

/* -------------------------------------------------------------------------- */
/* Static files (for admin dashboard etc.)                                    */
/* -------------------------------------------------------------------------- */
const publicDir = path.join(process.cwd(), "public");
app.use(express.static(publicDir, { extensions: ["html"] }));

/* Optional helper: /admin -> serve public/admin.html if present */
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"), (err) => {
    if (err) res.status(404).type("text/plain").send("admin.html not found");
  });
});

/* -------------------------------------------------------------------------- */
/* Root alias for /classify (frontend sometimes tries /classify)              */
/* -------------------------------------------------------------------------- */
app.use("/classify", ClassifyRouter);

/* -------------------------------------------------------------------------- */
/* 404 handlers                                                               */
/* -------------------------------------------------------------------------- */
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "not_found" }));
app.use((_req, res) => res.status(404).type("text/plain").send("Not Found"));

/* -------------------------------------------------------------------------- */
/* Generic error handler                                                      */
/* -------------------------------------------------------------------------- */
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", (err as any)?.message || err);
  res.status(500).json({ ok: false, error: "server_error" });
});

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */
const port = Number(CFG.port || process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`buyers-api listening on :${port} (env=${CFG.nodeEnv}) — /healthz, /ping, /api/*`);
});

export default app;