// src/shared/admin.ts
//
// Minimal admin auth guard for write endpoints.
// - Reads ADMIN_API_KEY (or CSV in ADMIN_API_KEYS) from env
// - Clients must send header:  x-admin-key: <value>
// - On failure returns 401 JSON (never throws)

import type { Request, Response, NextFunction } from "express";

const HDR = "x-admin-key";

function loadKeys(): string[] {
  const one = String(process.env.ADMIN_API_KEY || "").trim();
  const many = String(process.env.ADMIN_API_KEYS || "").trim();
  const out = new Set<string>();

  if (one) out.add(one);
  if (many) {
    for (const k of many.split(/[,\s]+/)) {
      const t = k.trim();
      if (t) out.add(t);
    }
  }
  return [...out];
}

const KEYS = loadKeys();

export function isAdmin(req: Request): boolean {
  if (!KEYS.length) return false;
  const k = String(req.headers[HDR] || "").trim();
  return !!k && KEYS.includes(k);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!KEYS.length) {
    // Misconfiguration safety: no keys configured -> always deny
    return res.status(401).json({ ok: false, error: "admin_auth_not_configured" });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: "admin_auth_required" });
  }
  next();
}

// Tiny helper so routes can export the header name in docs if needed
export const ADMIN_HEADER = HDR;