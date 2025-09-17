import type { Request, Response, NextFunction } from "express";

// Add any custom headers your front-end may send here.
const ALLOW_HEADERS = [
  "content-type",
  "x-api-key",
  "x-tenant",
  "x-region",
  "x-user",
  "authorization"
];

// If you later want to restrict origins, set FRONTEND_ORIGINS as a comma list.
const envOrigins = (process.env.FRONTEND_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

// Default to permissive for public GET/POST; browsers won’t allow credentials with "*".
function allowOrigin(req: Request): string {
  if (envOrigins.length === 0) return "*";
  const reqOrigin = req.headers.origin || "";
  return envOrigins.includes(reqOrigin) ? reqOrigin : envOrigins[0];
}

export function cors(req: Request, res: Response, next: NextFunction) {
  res.header("Access-Control-Allow-Origin", allowOrigin(req));
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", ALLOW_HEADERS.join(", "));

  // No cookies/credentials needed for Free Panel → do not set Allow-Credentials.

  if (req.method === "OPTIONS") {
    // Preflight success without hitting route handlers.
    return res.sendStatus(204);
  }
  next();
}
