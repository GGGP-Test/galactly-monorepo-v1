// src/routes/leads.ts
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import cors from "cors";

/**
 * A self-contained router that serves exactly what the free panel calls:
 *   - GET  /api/v1/leads?temp=warm|hot&region=us|ca|...
 *   - POST /api/v1/leads/find-buyers  { domain, region?, radiusMi? }
 *
 * It also registers synonym paths without the /api/v1 prefix so you won't
 * get 404s even if another part of the app mounts a prefix already.
 *
 * This is intentionally conservative: it returns empty lists for GET
 * and a 200 “created 0 candidates” for POST (so your panel stops 404’ing).
 * You can wire real logic behind the TODO blocks later.
 */

const ORIGIN = process.env.PANEL_ORIGIN || "https://gggp-test.github.io";
const API_KEY = process.env.PANEL_API_KEY || ""; // optional; leave blank to disable check

const router = Router();

// --- CORS + preflight that mirrors what your panel sends ---
const corsMw = cors({
  origin: ORIGIN,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
});
router.use(corsMw);

router.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- Optional API key gate (panel passes x-api-key) ---
function requireKey(req: Request, res: Response, next: NextFunction) {
  if (!API_KEY) return next(); // disabled
  const got = req.header("x-api-key");
  if (got && got === API_KEY) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// Helper to register both with and without /api/v1 prefix
function dual(path: string, handler: (req: Request, res: Response) => any, method: "get" | "post") {
  (router as any)[method](path, requireKey, handler);
  const noPrefix = path.replace(/^\/api\/v1/, "");
  if (noPrefix !== path) (router as any)[method](noPrefix, requireKey, handler);
}

// --- Health (for readiness probes) ---
router.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// --- GET /api/v1/leads --------------------------------------
dual("/api/v1/leads", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  const region = String(req.query.region || "usca").toLowerCase();

  // TODO: plug in your BLEED store filtering here
  // For now, respond empty but success (prevents 404 noise in panel)
  const payload = { ok: true, temp, region, count: 0, leads: [] as any[] };

  // Small log to match what you were seeing in logs before
  console.log(`[public] GET /leads -> 200 temp=${temp} region=${region} count=${payload.count}`);

  return res.status(200).json(payload);
}, "get");

// --- POST /api/v1/leads/find-buyers --------------------------
dual("/api/v1/leads/find-buyers", (req, res) => {
  let body: any = {};
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
  } catch {
    // ignore; will fall through to validation
  }

  const domain = (body?.domain || "").toString().trim().toLowerCase();
  const region = (body?.region || "usca").toString().trim().toLowerCase();
  const radiusMi = Number(body?.radiusMi || 50);

  if (!domain) {
    // Mirror the exact 400 your panel already displays if user forgot the field
    return res.status(400).json({ ok: false, error: "domain is required" });
  }

  // TODO: call your buyer discovery here (AI/heuristics/scrapers/etc.)
  // For now, don't create anything – just acknowledge and return a neutral result.
  const created = 0;
  const hot = 0;
  const warm = 0;
  const ids: string[] = [];

  console.log(`[buyers] find-buyers for domain=${domain} region=${region} radiusMi=${radiusMi} -> created=${created}`);

  return res.status(200).json({
    ok: true,
    created,
    hot,
    warm,
    ids,
    message: "stub-ok", // helps you confirm you’re hitting THIS route
  });
}, "post");

// Export a Router (not a function), so app.use(...) never sees undefined
export default router;