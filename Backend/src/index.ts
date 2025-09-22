// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { metrics } from "./routes/metrics"; // <- named export (router)

/**
 * Minimal, safe API bootstrap.
 * - No imports from ./lib or ./services
 * - Exposes /healthz for Docker healthcheck
 * - Mounts metrics router at /api/v1/metrics
 * - Optionally mounts a leads router if present (non-fatal if missing)
 */

const app = express();
const PORT = Number(process.env.PORT || 8787);

// Trust reverse proxies (useful on PaaS)
app.set("trust proxy", 1);

// Basic middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Liveness
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Metrics router
app.use("/api/v1/metrics", metrics);

// --- Optional leads router (mounted only if the module exists) ---
void (async () => {
  for (const candidate of [
    "./routes/leads",
    "./routes/lead",
    "./routes/buyers",
    "./routes/index",
  ]) {
    try {
      const mod: any = await import(candidate);
      const router =
        mod?.default ||
        mod?.leads ||
        mod?.router ||
        mod?.routes ||
        mod?.buyersRouter;
      if (router && typeof router === "function") {
        app.use("/api/v1/leads", router);
        // eslint-disable-next-line no-console
        console.log(`[buyers-api] mounted leads router from ${candidate}`);
        break;
      }
    } catch {
      // ignore; try next candidate
    }
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