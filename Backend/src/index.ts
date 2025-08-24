import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();

/**
 * CORS_ORIGIN supports:
 *  - comma-separated exact origins: "https://your.site,https://app.your.site"
 *  - "*" (dev only, allows any origin)
 *  - regex literal: "/^https:\/\/(.*\.)?your\.site$/"
 */
const raw = (process.env.CORS_ORIGIN || "").trim();
const allowed = raw ? raw.split(/\s*,\s*/).filter(Boolean) : [];

const origin: cors.CorsOptions["origin"] = (reqOrigin, cb) => {
  if (!reqOrigin) return cb(null, true);
  if (allowed.includes("*") || allowed.includes(reqOrigin)) return cb(null, true);
  for (const pat of allowed) {
    if (pat.startsWith("/") && pat.endsWith("/") && pat.length > 2) {
      const re = new RegExp(pat.slice(1, -1));
      if (re.test(reqOrigin)) return cb(null, true);
    }
  }
  return cb(new Error("CORS: origin not allowed"), false);
};

app.use(cors({ origin, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "x-admin-token"] }));
app.use(express.json());

// health & smoke
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/v1/status", (_req, res) => res.json({ status: "ok" }));
app.get("/api/v1/gate", (_req, res) => res.json({ ok: true }));

// keep your admin smoke endpoint responding
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || "").trim();
app.get("/api/v1/admin/queries.txt", (req, res) => {
  const tok = String(req.header("x-admin-token") || "");
  if (!ADMIN_TOKEN || tok !== ADMIN_TOKEN) return res.status(401).send("[]");
  res.type("application/json").send("[]");
});

// leads + peek
app.use("/api/v1", leadsRouter);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => console.log(`[galactly] listening on :${PORT}`));
