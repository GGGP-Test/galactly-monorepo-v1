// src/index.ts

import express from "express";
import cors from "cors";

/**
 * Try to load a router from a module that may export either:
 *   - a named export (e.g. export const metricsRouter = Router())
 *   - a default export (e.g. export default Router())
 * If the module can't be loaded, returns undefined so we don't crash builds.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function loadRouter(modulePath: string, namedExport: string): import("express").Router | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modulePath);
    const candidate = (mod && (mod[namedExport] || mod.default)) as import("express").Router | undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

const app = express();

// core middleware
app.use(cors());
app.use(express.json());

// optional request logger; don't crash if not installed
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const morgan = require("morgan");
  if (typeof morgan === "function") app.use(morgan("tiny"));
} catch {
  /* morgan not installed — ignore */
}

// health check for Docker
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// mount routers (works with named OR default exports)
const leadsRouter   = loadRouter("./routes/leads", "leadsRouter");
const metricsRouter = loadRouter("./routes/metrics", "metricsRouter");
const buyersRouter  = loadRouter("./routes/buyers", "buyersRouter"); // present if your project has it

if (leadsRouter)   app.use("/api/v1/leads",   leadsRouter);
if (metricsRouter) app.use("/api/v1/metrics", metricsRouter);
// some UIs call /api/v1/find-buyers or similar — keeping buyers under /api/v1
if (buyersRouter)  app.use("/api/v1", buyersRouter);

// 404 fallback (JSON)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "not found" });
});

// error handler (JSON)
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ ok: false, error: "server error" });
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});

export default app;