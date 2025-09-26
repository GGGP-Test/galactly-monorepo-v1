// src/index.ts
import express, { Application, Request, Response, NextFunction } from "express";
import { registerPrefs } from "./routes/prefs";
import { registerLeads } from "./routes/leads";
import { registerCatalog } from "./routes/catalog";
import { registerHealth } from "./routes/health";

const app: Application = express();

// Minimal request logger (replaces morgan to avoid prod dependency)
app.use((req: Request, _res: Response, next: NextFunction) => {
  // Keep it short; avoid logging bodies
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Register routes
registerHealth(app);
registerPrefs(app);
registerCatalog(app);
registerLeads(app);

// Error handler (last)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err?.stack || err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`buyers-api listening on :${PORT}`);
});