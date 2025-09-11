// Backend/src/index.ts
// Express bootstrap mounting health, public, leads, reveal, and find-buyers routes.

import express from "express";
import cors from "cors";
import { mountPublic } from "./routes/public";
import { mountLeads } from "./routes/leads";
import { mountReveal } from "./api/reveal";
import { mountFind } from "./routes/find";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: "*"}));
app.use(express.json({ limit: "1mb" }));

// health
app.get("/healthz", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/readyz", (_req, res) => res.json({ ok: true, ready: true, time: new Date().toISOString() }));
app.get("/version", (_req, res) => res.json({ ok: true, version: process.env.VERSION || "dev" }));

// simple config (mirrors what you tested)
app.get("/api/v1/config", (_req, res) =>
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "production",
    devUnlimited: false,
    allowList: [],
    version: process.env.VERSION || "dev",
    time: new Date().toISOString(),
  })
);

// routes
mountPublic(app);
mountLeads(app);
mountReveal(app);
mountFind(app);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// listen (Northflank supplies PORT)
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
});
