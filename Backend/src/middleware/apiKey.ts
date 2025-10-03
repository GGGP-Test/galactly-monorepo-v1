// src/middleware/apiKey.ts
import { Request, Response, NextFunction } from "express";

/**
 * If the given env var is set (e.g. ADMIN_KEY), require clients to send
 *   header: x-api-key: <that value>
 * If the env var is NOT set, the route stays open.
 */
export function requireApiKey(envVar = "X_API_KEY") {
  const needed = (process.env[envVar] || "").trim();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!needed) return next(); // open if key not configured
    const got = String(req.headers["x-api-key"] || "").trim();
    if (got && got === needed) return next();
    res.status(401).json({ ok: false, error: "missing_or_bad_api_key" });
  };
}