// src/routes/health.ts
import type { Application, Request, Response } from "express";

export function registerHealth(app: Application, base = "/health"): void {
  app.get(base, (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
}