import express, { Request, Response, NextFunction } from "express";
import { mountPublic } from "./routes/public";

// --- basic settings ---
const PORT = Number(process.env.PORT || 8787);

// Create app
const app = express();

// If running behind a proxy (Envoy/Northflank), this helps trust X-Forwarded-* headers
app.set("trust proxy", true);

// Tiny built-in logger (no external deps)
app.use((req: Request, _res: Response, next: NextFunction) => {
  // keep it short; don’t log bodies
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

// Mount our public API (/api/...)
mountPublic(app);

// Root ping (useful for health)
app.get("/", (_req, res) => res.type("text/plain").send("ok"));

// Global error guard (prevents unhandled rejections from killing the process)
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// Start server
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});