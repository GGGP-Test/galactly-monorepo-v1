import type { Request, Response, NextFunction } from "express";

/**
 * Reads your API key from environment (any of these, first non-empty wins)
 * and compares it to the incoming 'x-api-key' header.
 *
 * Accepts: APIKey, API_KEY, API_Key, AdminKey, AdminToken
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const token =
    process.env.APIKey ||
    process.env.API_KEY ||
    (process.env as any).API_Key ||
    process.env.AdminKey ||
    process.env.AdminToken ||
    "";

  const got = String(req.header("x-api-key") || "");
  if (!token) {
    return res.status(500).json({ ok: false, error: "server missing API key" });
  }
  if (!got || got !== token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}
