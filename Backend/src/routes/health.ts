// src/routes/health.ts
import type { Application, Request, Response } from "express";

/**
 * Wire simple health endpoints.
 * - GET /healthz -> "ok" (string) for k8s-style probes
 * - GET /health  -> JSON payload with service metadata
 */
function registerHealth(app: Application): void {
  app.get("/healthz", (_req: Request, res: Response) => {
    res.type("text/plain").send("ok");
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "buyers-api",
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
    });
  });
}

// Export both ways to be tolerant of either import style.
export { registerHealth };
export default registerHealth;