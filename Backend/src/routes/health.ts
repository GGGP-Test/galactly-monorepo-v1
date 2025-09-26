// src/routes/health.ts
import type { Application, Request, Response } from "express";

/**
 * Registers lightweight health endpoints.
 * Deliberately no catalog/prefs dependencies so index.ts can call with just (app).
 */
export function registerHealth(app: Application): void {
  // JSON health (used by Dockerfile's HEALTHCHECK -> /healthz)
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      service: "buyers-api",
      ts: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Optional plaintext variant
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).type("text/plain").send("ok");
  });

  // A minimal HEAD handler for fast probes (no body)
  app.head("/healthz", (_req: Request, res: Response) => {
    res.status(200).end();
  });
}