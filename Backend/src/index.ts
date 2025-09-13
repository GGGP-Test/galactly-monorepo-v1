// src/index.ts
import express from "express";
import mountBuyers from "./routes/buyers";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "https://gggp-test.github.io";

// Basic CORS for all routes (tighten later if you want)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Global body parsers (so every router sees JSON/urlencoded bodies)
app.use(express.json({ limit: "1mb", strict: false }));
app.use(express.urlencoded({ extended: true }));

// Healthcheck for Northflank
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// (Optional) serve a static public dir if you have one
const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir));

// Mount API routes
mountBuyers(app); // mounts at /api/v1/leads

// Fallback 404 for API
app.use("/api", (_req, res) =>
  res.status(404).json({ ok: false, error: "Not found" })
);

// Start server
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});