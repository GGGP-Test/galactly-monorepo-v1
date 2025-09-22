// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import path from "path";

// Routers
import leadsRouter from "./routes/leads";
import metricsRouter from "./routes/metrics";

// ---- basic server setup (no extra deps) ----
const app = express();
const PORT = Number(process.env.PORT || 8787);

// tiny JSON/body support
app.use(express.json({ limit: "1mb" }));

// ---- CORS (manual; no 'cors' package required) ----
const allowedCsv = (process.env.CORS_ORIGIN || "").trim();
const allowedOrigins = allowedCsv
  ? allowedCsv.split(",").map(s => s.trim()).filter(Boolean)
  : [];

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = String(req.headers.origin || "");
  const allow =
    allowedOrigins.length === 0 ||
    allowedOrigins.includes(origin) ||
    allowedOrigins.includes("*");

  if (allow && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-api-key, x-requested-with"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  next();
});

// ---- health ----
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// ---- api v1 ----
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// Optional static (kept off unless ALLOW_WEB=true)
if (String(process.env.ALLOW_WEB || "").toLowerCase() === "true") {
  app.use(express.static(path.join(process.cwd(), "public")));
}

// ---- fallback & error handling ----
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server:error]", err?.stack || err?.message || String(err));
  res.status(500).json({ ok: false, error: "internal error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on :${PORT}`);
});