// Backend/src/index.ts
import express from "express";
import cors from "cors";
import type { Express, Request, Response } from "express";
import { mountLeads } from "./routes/leads"; // expects a named export mountLeads(app)

const PORT = Number(process.env.PORT || 8787);

function createApp(): Express {
  const app = express();

  // Core middleware
  app.use(express.json({ limit: "1mb" }));
  app.use(cors()); // allow GitHub Pages (and others)

  // Health/readiness/liveness
  app.get("/", (_req: Request, res: Response) => {
    res.type("text/plain").send("ok");
  });

  // Northflank readiness probe (your probe calls /healthz)
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });

  // Optional liveness alias
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // Mount API (leads routes register under /api/v1/...)
  mountLeads(app);

  // 404 handler (after all routes)
  app.use((req, res) => {
    res.status(404).json({ ok: false, error: "not_found", path: req.path });
  });

  // Basic error handler
  app.use(
    (
      err: any,
      _req: Request,
      res: Response,
      _next: (e?: any) => void // eslint-disable-line @typescript-eslint/no-unused-vars
    ) => {
      console.error("Unhandled error:", err);
      res
        .status(500)
        .json({ ok: false, error: "internal_error", detail: String(err?.message || err) });
    }
  );

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[api] listening on :${PORT}`);
  });
}

export { createApp };
