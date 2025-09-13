// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

// ---- config ----------------------------------------------------
const PORT = Number(process.env.PORT || 8787);
const API_BASE = "/api/v1";

// Allow GitHub Pages origin by default; override with FRONTEND_ORIGIN if needed
const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN ||
  "https://gggp-test.github.io";

// ---- app -------------------------------------------------------
const app = express();

// CORS for browser panel
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server / curl (no Origin header)
      if (!origin) return cb(null, true);
      if (origin === FRONTEND_ORIGIN) return cb(null, true);
      // also allow any *.github.io page you control, if you move repos
      if (origin.endsWith(".github.io")) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);

// JSON/body parsing for POST /find-buyers etc.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// health
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// ---- routes ----------------------------------------------------
// IMPORTANT: both routers must be mounted under /api/v1
import publicRoutes from "./routes/public";
import buyersRoutes from "./routes/buyers";

app.use(API_BASE, publicRoutes);
console.log(`[routes] mounted public from ./routes/public`);

app.use(API_BASE, buyersRoutes);
console.log(`[routes] mounted buyers from ./routes/buyers`);

// 404 for unknown API endpoints (helps debugging)
app.use(API_BASE, (req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "not_found",
    path: req.path,
    hint: "Check the API_BASE and that the router handles this path.",
  });
});

// generic error handler (so 500s return JSON to the panel)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err);
  res
    .status(err?.status || 500)
    .json({ ok: false, error: err?.message || "internal_error" });
});

// ---- start -----------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});