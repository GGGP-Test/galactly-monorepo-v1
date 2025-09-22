// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import leadsRouter from "./routes/leads";

const PORT = Number(process.env.PORT || 8787);

/** Minimal allowlist CORS with x-api-key preflight support */
function corsAllowlist() {
  const raw = (process.env.CORS_ORIGIN || "").trim();
  const allowAny = raw === "*" || raw.toLowerCase() === "true";
  const list = allowAny
    ? ["*"]
    : raw.split(",").map(s => s.trim()).filter(Boolean);

  return function cors(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin as string | undefined;
    let allowed = allowAny ? (origin ?? "*") : undefined;
    if (!allowed && origin && list.length && list.includes(origin)) {
      allowed = origin;
    }
    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", allowed);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key, X-API-KEY");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      // res.setHeader("Access-Control-Allow-Credentials", "true"); // enable later if needed
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(corsAllowlist());

// ---- health endpoints (both, to match Dockerfile probe) ----
function healthPayload() {
  return {
    ok: true,
    ts: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    port: PORT,
    sha: process.env.GIT_SHA || process.env.COMMIT || undefined,
  };
}
app.get("/", (_req, res) => res.json({ ok: true }));
app.get("/ping", (_req, res) => res.json({ ok: true, pong: true }));
app.get("/health", (_req, res) => res.json(healthPayload()));
app.get("/healthz", (_req, res) => res.json(healthPayload())); // <— Dockerfile probes this

// ---- API v1 ----
app.use("/api/v1/leads", leadsRouter);

// 404 JSON
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Error JSON
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server:error]", err?.stack || err?.message || String(err));
  res.status(typeof err?.status === "number" ? err.status : 500).json({
    ok: false,
    error: err?.message || "internal error",
  });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});