// src/routes/public.ts
import express, { Router, json, urlencoded } from "express";
import cors from "cors";
import path from "path";

/**
 * Public-facing plumbing:
 *  - /healthz
 *  - CORS preflight
 *  - body parsers
 *  - static assets under /assets
 */
const router = Router();

// 1) health
router.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// 2) CORS (allow panel on GitHub Pages)
router.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key"],
  })
);
router.options("*", cors());

// 3) body parsers (pass options INSIDE the factory)
router.use(json({ limit: "1mb" }));
router.use(urlencoded({ extended: true, limit: "1mb" }));

// 4) static assets (put your files in ./public)
const staticDir = path.join(process.cwd(), "public");
router.use(
  "/assets",
  express.static(staticDir, {
    maxAge: "7d",
    setHeaders(res) {
      // avoids transform error: this must be inside setHeaders, not as a separate arg to app.use
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    },
  })
);

export default router;