// src/routes/health.ts
import type { Application, Request, Response } from "express";

/**
 * Very small health endpoints.
 * - No catalog touching (keeps types simple, avoids array/object confusion).
 * - Exports both a named and default function so index.ts can import either way.
 */
export function registerHealth(app: Application): void {
  // Liveness: plain text for cheap probes
  app.get("/healthz", (_req: Request, res: Response) => {
    res.type("text").send("ok");
  });

  // Readiness: tiny JSON with server time
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      now: new Date().toISOString(),
    });
  });
}

export default registerHealth;