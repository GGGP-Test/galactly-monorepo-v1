import type { Request, Response, NextFunction } from "express";

/** Return the first non-empty value (trimmed). */
function firstNonEmpty(...vals: Array<string | undefined | null>): string | null {
  for (const v of vals) {
    if (v && v.trim() !== "") return v.trim();
  }
  return null;
}

/** Resolve the API/admin token from environment (supports several names). */
export function resolveApiKeyFromEnv(): string | null {
  const e = process.env;
  return firstNonEmpty(
    e.API_KEY,      // recommended
    (e as any).APIKey, // your current var name
    e.ADMIN_TOKEN,
    (e as any).AdminToken,
    e.ADMIN_KEY,
    (e as any).AdminKey
  );
}

export const API_HEADER = "x-api-key";

/** Middleware: require a valid API key. */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = resolveApiKeyFromEnv();
  if (!expected) {
    res.status(500).json({ ok: false, error: "server_misconfigured:no_api_key" });
    return;
  }
  const provided =
    (req.header(API_HEADER) || String(req.query.apiKey || "")).trim();

  if (!provided || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

/** Small summary object that /public/env can return. */
export function envSummary() {
  const allowList = (process.env.ALLOW_LIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const devUnlimited = ["1", "true", "yes", "on"].includes(
    String(process.env.DEV_UNLIMITED || "").toLowerCase()
  );
  return {
    ok: true as const,
    env: process.env.NODE_ENV || "development",
    devUnlimited,
    allowList,
    version: process.env.GIT_COMMIT || process.env.RELEASE || "dev",
    time: new Date().toISOString(),
  };
}
