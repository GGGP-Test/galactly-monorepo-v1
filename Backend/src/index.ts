// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import morgan from "morgan";

import leadsRouter from "./routes/leads";
import { metricsRouter } from "./routes/metrics"; // <- named export

// ---------- config ----------
const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || "production";
const ALLOW_WEB = String(process.env.ALLOW_WEB || "true").toLowerCase() === "true";
const RAW_ORIGINS = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);

// ---------- app ----------
const app = express();
app.set("trust proxy", true);

// body + logs
app.use(express.json({ limit: "1mb" }));
app.use(morgan(NODE_ENV === "production" ? "tiny" : "dev"));

// CORS (allow if ALLOW_WEB=true; if CORS_ORIGIN provided, restrict to those)
const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    if (!ALLOW_WEB) return cb(null, false);               // block browsers entirely
    if (!origin) return cb(null, true);                   // curl / server-to-server
    if (RAW_ORIGINS.length === 0) return cb(null, true);  // no list -> allow
    const ok = RAW_ORIGINS.some(o => origin === o || origin.endsWith(o));
    return cb(ok ? null : new Error("CORS"), ok);
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "x-api-key"],
  methods: ["GET", "POST", "OPTIONS"]
};
app.use(cors(corsOptions));

// ---------- health ----------
app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "buyers-api", env: NODE_ENV, ts: new Date().toISOString() });
});
app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true }));

// ---------- routes ----------
app.use("/api/v1/leads", leadsRouter);
app.use("/api/v1/metrics", metricsRouter);

// ---------- errors ----------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const code = err?.status || 500;
  const msg = err?.message || "internal error";
  if (NODE_ENV !== "production") console.error("[error]", err);
  res.status(code).json({ ok: false, error: msg });
});

app.use((_req: Request, res: Response) => res.status(404).json({ ok: false, error: "not found" }));

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`[buyers-api] listening on :${PORT} (env=${NODE_ENV})`);
});