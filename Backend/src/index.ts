import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

/**
 * Minimal, safe API bootstrap.
 * - No imports from ./lib or ./services
 * - HEALTH: /healthz (used by Dockerfile)
 * - Mounts /api/v1/metrics and /api/v1/leads if their routers exist.
 *   (Supports both default and named exports to avoid “no default export” TS errors.)
 */

const app = express();
const PORT = Number(process.env.PORT || 8787);

// Trust reverse proxies (PaaS)
app.set("trust proxy", 1);

// Core middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Liveness for healthcheck
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

/**
 * Try to mount a router if the module exists.
 * Accepts any of: default, metrics, router, routes, leads, buyersRouter
 */
async function tryMount(path: string, mountAt: string, label: string) {
  try {
    const mod: any = await import(path);
    const candidate =
      mod?.default ??
      mod?.metrics ??
      mod?.router ??
      mod?.routes ??
      mod?.leads ??
      mod?.buyersRouter;

    if (candidate && typeof candidate === "function") {
      app.use(mountAt, candidate);
      // eslint-disable-next-line no-console
      console.log(`[buyers-api] mounted ${label} from ${path} at ${mountAt}`);
      return true;
    }
  } catch {
    // ignore – optional
  }
  return false;
}

// Mount optional routers (both metrics and leads) without failing the app
void (async () => {
  // Metrics
  const mountedMetrics =
    (await tryMount("./routes/metrics", "/api/v1/metrics", "metrics")) ||
    (await tryMount("./routes/index", "/api/v1/metrics", "metrics"));

  if (!mountedMetrics) {
    // eslint-disable-next-line no-console
    console.log("[buyers-api] metrics router not found (optional)");
  }

  // Leads
  const mountedLeads =
    (await tryMount("./routes/leads", "/api/v1/leads", "leads")) ||
    (await tryMount("./routes/lead", "/api/v1/leads", "leads")) ||
    (await tryMount("./routes/buyers", "/api/v1/leads", "leads")) ||
    (await tryMount("./routes/index", "/api/v1/leads", "leads"));

  if (!mountedLeads) {
    // eslint-disable-next-line no-console
    console.log("[buyers-api] leads router not found (optional)");
  }
})();

// 404 (JSON)
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found", path: req.path });
});

// Error handler (JSON)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("[buyers-api] error:", err);
  res
    .status(err?.status || 500)
    .json({ ok: false, error: err?.message || "Internal error" });
});

// Start
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[buyers-api] listening on :${PORT}`);
});