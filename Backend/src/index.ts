// Backend/src/index.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import buyers from "./routes/buyers";
import publicRoutes from "./routes/public";

const app = express();

// Trust proxy (Northflank/Envoy)
app.set("trust proxy", true);

// Basic request log
app.use(morgan("tiny"));

// JSON body
app.use(express.json({ limit: "1mb" }));

// CORS for GitHub Pages (and local dev)
const ALLOW_ORIGINS = new Set([
  "https://gggp-test.github.io",
  "http://localhost:5173",
  "http://localhost:8080",
]);

app.use((req: Request, res: Response, next: NextFunction) => {
  const o = req.headers.origin || "";
  if (ALLOW_ORIGINS.has(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  // short-circuit preflight without using app.options/router.options
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Liveness
app.get("/healthz", (_req, res) => res.type("text").send("ok"));

// Routes
publicRoutes(app);
buyers(app);

// Error handler (never leak stacks)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.status || 500);
  const msg = status >= 500 ? "Internal Server Error" : String(err?.message || "Bad Request");
  res.status(status).json({ ok: false, error: msg });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  console.log(`[routes] mounted buyers from ./routes/buyers`);
  console.log(`[routes] mounted public from ./routes/public`);
});

export default app;