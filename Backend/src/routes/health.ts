import type { Express, Request, Response } from "express";

export function registerHealth(app: Express): void {
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });
}

// Keep default export too so either import style works
export default registerHealth;