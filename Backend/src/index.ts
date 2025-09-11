import express from "express";
import type { Request, Response, NextFunction } from "express";
import { mountLeads } from "./routes/leads";

// ---- tiny CORS middleware (no external deps) ----
function allowCORS(req: Request, res: Response, next: NextFunction) {
  // allow all origins (GitHub Pages, your local file, etc.)
  res.header("Access-Control-Allow-Origin", "*");
  // allow the headers our panel and API use
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, x-api-key"
  );
  // allow common methods used by the panel
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  // short-circuit preflight
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

const app = express();

// order matters: CORS first, then parsers, then routes
app.use(allowCORS);
app.use(express.json({ limit: "1mb" }));

// health
app.get("/", (_req, res) => res.json({ ok: true, service: "backend", time: new Date().toISOString() }));
app.get("/api/ping", (_req, res) => res.json({ ok: true, pong: true, time: new Date().toISOString() }));

// API routes
mountLeads(app); // exposes /api/v1/leads/* (hot, warm, :id, stage, notes, export.csv, ingest, ...)

// 404 (JSON)
app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));

// error guard (JSON)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  const msg = (err && err.message) || "internal error";
  res.status(500).json({ ok: false, error: msg });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`[backend] listening on ${PORT}`);
});
