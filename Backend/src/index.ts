// src/index.ts
//
// Express bootstrap with:
// - tiny built-in request logger (no morgan dep)
// - strict CORS using ALLOW_ORIGINS env (csv) or "*" fallback
// - mounts: /api/health, /api/prefs, /api/leads, /api/catalog
// - safe error handler
//
// No external deps added.

import express, { Request, Response, NextFunction } from "express";

import PlacesRouter from "./routes/places";
// Routers (current exports: default Router for health/leads/catalog; factory for prefs)
import HealthRouter from "./routes/health";
import PrefsRouter from "./routes/prefs";
import LeadsRouter from "./routes/leads";
import CatalogRouter from "./routes/catalog";

const app = express();

// Trust proxy for correct IP / protocol when behind Northflank proxy
app.set("trust proxy", true);

// -------- Tiny request logger (no dependency) --------
function tinyLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    // keep it short to avoid noisy logs
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`,
    );
  });
  next();
}
app.use(tinyLogger);

// -------- Minimal JSON body parsing (routes also parse if they need to) --------
app.use(express.json({ limit: "256kb" }));

// -------- Strict CORS (no "cors" package) --------
// ALLOW_ORIGINS can be:
//   "*"                         -> allow all
//   "https://a.com,https://b.com"  -> allow list
// We also accept hostnames (e.g. "panel.example.com") for convenience.
const allowList = String(process.env.ALLOW_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function originAllowed(origin: string | undefined): string | undefined {
  if (!origin) return "*"; // non-browser or same-origin fetch; allow
  if (allowList.length === 0) return origin; // default to echo-origin if no env set
  if (allowList.includes("*")) return origin;
  if (allowList.includes(origin)) return origin;
  try {
    const host = new URL(origin).hostname;
    if (allowList.includes(host)) return origin;
  } catch {
    // ignore malformed origin
  }
  return undefined;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin as string | undefined;
  const allow = originAllowed(origin);

  // Always vary on Origin for caches/CDNs
  res.setHeader("Vary", "Origin");

  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow === "*" ? "*" : origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  // Fast exit for preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// Plain readiness endpoint for infra probes (no router/prefix)
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

// -------- Mount routers --------
app.use("/api/health", HealthRouter);    // expects default Router
app.use("/api/prefs", PrefsRouter());    // prefs exports a factory -> call it
app.use("/api/leads", LeadsRouter);      // default Router
app.use("/api/catalog", CatalogRouter);  // default Router
app.use("/api/places", PlacesRouter);
// Simple root
app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "buyers-api", at: new Date().toISOString() });
});

// -------- Error handler (must have 4 args) --------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  const msg = (err && (err.message || err.toString())) || "internal-error";
  res.status(500).json({ ok: false, error: msg });
});

// -------- Start server --------
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`[buyers-api] listening on :${PORT}`);
});

// helpful for tests
export default app;