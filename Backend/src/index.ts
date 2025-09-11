// src/index.ts
import express, { type Express } from "express";
import cors from "cors";

// IMPORTANT: default imports match your route files which default-export their mounters
import mountLeads from "./routes/leads";
import mountBuyers from "./routes/buyers";
import mountWebscout from "./routes/webscout";
import mountFind from "./routes/find";

const app: Express = express();

// basic middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// health/readiness (Northflank probes this)
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// mount all feature routes (each file should default-export a (app)=>void)
if (typeof mountLeads === "function") mountLeads(app);
if (typeof mountBuyers === "function") mountBuyers(app);
if (typeof mountWebscout === "function") mountWebscout(app);
if (typeof mountFind === "function") mountFind(app);

// 404 fallback for API
app.use((req, res, _next) => {
  // keep it quiet for non-API paths
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found", path: req.path });
  } else {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});

export default app;
