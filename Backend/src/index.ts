// src/index.ts
// Express bootstrap with strict CORS, tiny logger, canonical /api/* mounts,
// plus /ping endpoints, /classify root alias, and graceful shutdown.

import express, { Request, Response, NextFunction } from "express";

import HealthRouter from "./routes/health";
import PrefsRouter from "./routes/prefs";
import LeadsRouter from "./routes/leads";
import CatalogRouter from "./routes/catalog";
import PlacesRouter from "./routes/places";
import ClassifyRouter from "./routes/classify";
import EventsRouter from "./routes/events";              // <-- new: events router
import BuyersRouter, { RootAlias as FindAlias } from "./routes/buyers";

import { CFG, isOriginAllowed } from "./shared/env";
import { enableGracefulShutdown } from "./shared/shutdown"; // <-- use YOUR existing API

const app = express();

/* -------------------------------------------------------------------------- */
/* Basic hardening                                                            */
/* -------------------------------------------------------------------------- */
app.disable("x-powered-by");
app.set("trust proxy", true);

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
/* Strict CORS                                                                */
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
/* Health & Ping                                                              */
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
app.use("/api/find", FindAlias);
app.use("/api/events", EventsRouter);  // <-- mount events

/* -------------------------------------------------------------------------- */
/* Root alias for /classify                                                   */
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
/* Boot + graceful shutdown                                                   */
/* -------------------------------------------------------------------------- */
const port = Number(CFG.port || process.env.PORT || 8787);
const server = app.listen(port, () => {
  console.log(`buyers-api listening on :${port} (env=${CFG.nodeEnv}) — /healthz, /ping, /api/*`);
});

// Use your existing shutdown helper (takes the Server)
enableGracefulShutdown(server, { timeoutMs: 10_000 });

export default app;