// src/index.ts
import express, { type Application, type Request, type Response, type NextFunction } from "express";
import cors from "cors";

// Routers (each defines absolute paths internally)
import HealthRouter from "./routes/health";
import PrefsRouter from "./routes/prefs";
import LeadsRouter from "./routes/leads";
import CatalogRouter from "./routes/catalog";

const app: Application = express();

// --- Middlewares ---
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Optional morgan: don’t crash if it isn’t installed in prod layer
(function attachLogger(a: Application) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const morgan = require("morgan") as (fmt: string) => any;
    const fmt = process.env.NODE_ENV === "production" ? "tiny" : "dev";
    a.use(morgan(fmt));
  } catch {
    // Minimal fallback logger
    a.use((req: Request, res: Response, next: NextFunction) => {
      const t0 = Date.now();
      res.on("finish", () => {
        const ms = Date.now() - t0;
        // keep it short to avoid noisy logs in Northflank
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
      });
      next();
    });
  }
})(app);

// --- Mount routers ---
app.use(HealthRouter);   // /healthz, /health
app.use("/api/prefs", PrefsRouter()); // GET/POST, /defaults
app.use(LeadsRouter);    // /api/leads/find-buyers
app.use(CatalogRouter);  // /api/catalog/*

// Root info
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "buyers-api", at: new Date().toISOString() });
});

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const code = Number(err?.status || 500);
  const msg = String(err?.message || "internal_error");
  console.error("Unhandled error:", msg);
  res.status(code).json({ ok: false, error: msg });
});

// Start server when executed directly (Docker runs node dist/index.js)
if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, () => {
    console.log(`buyers-api listening on :${port}`);
  });
}

export default app;