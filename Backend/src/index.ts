import express, { Express, Request, Response } from "express";
import cors from "cors";
import path from "path";

// IMPORTANT: routes/leads exports mountLeads as the DEFAULT export
import mountLeads from "./routes/leads";

const PORT = Number(process.env.PORT || 8787);

export function createServer(): Express {
  const app = express();

  // Basic hardening & JSON
  app.set("trust proxy", true);
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health endpoints for Northflank
  app.get("/healthz", (_req: Request, res: Response) =>
    res.status(200).send("ok")
  );
  app.get("/readyz", (_req: Request, res: Response) =>
    res.status(200).send("ok")
  );

  // Mount API routes
  // NOTE: mountLeads is a default export function (app: Express) => void
  mountLeads(app);

  // Root info
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "packlead-runtime",
      ts: new Date().toISOString(),
      docs: "/api/v1/leads",
    });
  });

  return app;
}

if (require.main === module) {
  const app = createServer();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on :${PORT}`);
  });
}

export default createServer;
