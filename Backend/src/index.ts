// src/index.ts
// Express boot with strict CORS, tiny logger, and all API routes (including /api/classify)

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import cors from "cors";

import leads from "./routes/leads";
import prefs from "./routes/prefs";
import catalog from "./routes/catalog";
import places from "./routes/places";
import classify from "./routes/classify"; // <- ensure this exists
import { CFG } from "./shared/env";

// ---- tiny logger ------------------------------------------------------------
function tinyLog(req: Request, _res: Response, next: NextFunction) {
  const t0 = Date.now();
  const { method, url } = req;
  resOnFinish(_res, () => {
    const ms = Date.now() - t0;
    const code = _res.statusCode;
    // keep logs small and readable
    console.log(`${method} ${url} -> ${code} ${ms}ms`);
  });
  next();
}
function resOnFinish(res: Response, cb: () => void) {
  res.once("finish", cb);
  res.once("close", cb);
}

// ---- strict CORS ------------------------------------------------------------
const allowList = (CFG.allowOrigins || "").split(",").map(s => s.trim()).filter(Boolean);
const corsOpts: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin / server-side
    if (allowList.length === 0 || allowList.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"), false);
  },
  credentials: true,
};

// ---- app --------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.use(tinyLog);
app.use(cors(corsOpts));
app.use(express.json({ limit: "512kb" }));

// ---- health -----------------------------------------------------------------
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    env: {
      node: process.version,
      tier_allow: CFG.allowTiers,
      cors: allowList,
    },
  });
});

// ---- APIs -------------------------------------------------------------------
app.use("/api/prefs", prefs);
app.use("/api/leads", leads);
app.use("/api/catalog", catalog);
app.use("/api/places", places);
app.use("/api/classify", classify); // <- this fixes the 404

// ---- docs (static) ----------------------------------------------------------
const docsDir = path.join(__dirname, "../docs");
app.use(express.static(docsDir, { extensions: ["html"] }));
app.get("/", (_req, res) => res.sendFile(path.join(docsDir, "index.html")));

// ---- not found / errors -----------------------------------------------------
app.use((req, res) => res.status(404).json({ ok: false, error: "not_found", path: req.path }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("ERR", err?.message || err);
  res.status(500).json({ ok: false, error: "server_error" });
});

// ---- listen -----------------------------------------------------------------
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`buyers-api listening on :${PORT}`);
});

export default app;