import express, { Request, Response, NextFunction } from "express";
import cors, { CorsOptions } from "cors";
import path from "node:path";

// Routers (your existing routes index that mounts /leads, /metrics, etc.)
import routes from "./routes";

const app = express();
app.disable("x-powered-by");

// ---- CORS ----------------------------------------------------
// Allowed origins: set CORS_ORIGINS env as a comma-separated list,
// e.g. "https://gggp-test.github.io, http://localhost:3000"
const defaultOrigins = [
  "https://gggp-test.github.io", // your free panel host
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const envOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = (envOrigins.length ? envOrigins : defaultOrigins);

// If you want to temporarily open CORS to everything, set ALLOW_WEB=true
const allowAll = String(process.env.ALLOW_WEB || "").toLowerCase() === "true";

const corsOptions: CorsOptions = {
  origin: allowAll ? true : function (origin, callback) {
    // no origin (e.g., curl) => allow
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "X-API-Key",       // <<< REQUIRED for your free panel
    "Authorization",
    "Accept",
  ],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

app.use((req, res, next) => {
  // Help caching CORS per-origin at proxies/CDNs
  res.header("Vary", "Origin");
  next();
});

app.use(cors(corsOptions));
// Ensure all preflight requests are handled
app.options("*", cors(corsOptions));

// ---- Body parsers -------------------------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// ---- Healthcheck (Dockerfile calls this) --------------------
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

// ---- API (v1) -----------------------------------------------
app.use("/api/v1", routes);

// ---- 404 for unknown API routes (keeps logs clean) ----------
app.use((req: Request, res: Response, _next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  res.status(404).send("Not found");
});

// ---- Error handler (ensures JSON for API) -------------------
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = err?.status || 500;
  const body =
    req.path.startsWith("/api/")
      ? { ok: false, error: err?.message || "Server error" }
      : err?.message || "Server error";
  if (status >= 500) console.error(err);
  res.status(status).send(body);
});

// ---- Server start -------------------------------------------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});