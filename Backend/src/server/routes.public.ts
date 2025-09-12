// src/server/routes.public.ts
import type { Application, Request, Response } from "express";

export function mountPublic(app: Application): void {
  // simple health check
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // optional ping (safe no-op)
  app.get("/ping", (_req: Request, res: Response) => {
    res.type("text").send("pong");
  });
}

// support both `import { mountPublic }` and `import mountPublic`
export default mountPublic;
