// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import leadsRouter from "./routes/leads";

// --- config ---
const PORT = Number(process.env.PORT || 8787);

/**
 * Allowlist CORS (no external dep).
 * CORS_ORIGIN can be a comma-separated list, "*", or empty (disables CORS).
 * Always allow our health endpoints. Preflight supports x-api-key.
 */
function corsAllowlist() {
  const raw = (process.env.CORS_ORIGIN || "").trim();
  const allowAny = raw === "*" || raw.toLowerCase() === "true";
  const list = allowAny
    ? ["*"]
    : raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

  return function cors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin as string | undefined;

    // If explicitly any, echo back the caller origin when present
    // (so credentials can work in the future if you need them).
    let allowed = allowAny ? origin ?? "*" : undefined;

    if (!allowed && origin && list.length) {
      // exact match against the allowlist entries
      if (list.includes(origin)) allowed = origin;
    }

    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", allowed);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, x-api-key"
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );
      // you can enable credentials later if you need:
      // res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(corsAllowlist());

// --- health/ping ---
app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
app.get("/ping", (_req, res) => res.json({ ok: true, pong: true }));

// --- API v1 ---
app.use("/api/v1/leads", leadsRouter);

// 404 handler (JSON)
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// error handler (JSON)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("[server:error]", err?.stack || err?.message || String(err));
  res
    .status(typeof err?.status === "number" ? err.status : 500)
    .json({ ok: false, error: err?.message || "internal error" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});