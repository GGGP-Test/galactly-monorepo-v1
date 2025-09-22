import express from "express";
import type { Router } from "express";
import { metricsRouter, metrics } from "./routes/metrics";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 8787);
const NODE_ENV = process.env.NODE_ENV ?? "development";

/** Liveness */
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

/**
 * Mount metrics API (public + record)
 * NOTE: Do NOT app.use(metrics) — metrics is a helper object, not middleware.
 */
app.use("/api/v1", metricsRouter);

/**
 * If a leads router exists in src/routes/leads.ts, mount it.
 * This keeps this file safe whether or not that module exists.
 */
let leadsRouter: Router | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("./routes/leads");
  leadsRouter =
    (mod && (mod.default as Router)) ||
    (mod && (mod.leadsRouter as Router)) ||
    undefined;
} catch {
  // no-op: leads route is optional in this build
}

if (leadsRouter) {
  app.use("/api/v1", leadsRouter);
} else {
  // Safe fallback so the build stays green if leads router is absent.
  app.post("/api/v1/leads", (_req, res) => {
    res.status(501).json({ ok: false, error: "leads route not wired" });
  });
}

/**
 * Optional: minimal hook you can call from your actual leads handler after
 * selecting a lead. Example:
 *   metrics.recordLeadShown(host, "warm");
 *   const fomo = metrics.getFomo(host);
 *   res.json({ ok: true, leads, fomo });
 */
app.post("/api/v1/metrics/demo-show", (req, res) => {
  const host = (req.body?.host as string) || "example.com";
  metrics.recordLeadShown(host, "warm");
  res.json({ ok: true, fomo: metrics.getFomo(host) });
});

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${NODE_ENV} listening on :${PORT}`);
  });
}

export default app;