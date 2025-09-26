// src/index.ts
import express, { Application } from "express";
import http from "http";

// Route registrars – all default exports
import registerHealth from "./routes/health";
import registerPrefs from "./routes/prefs";
import registerCatalog from "./routes/catalog";
import registerLeads from "./routes/leads";

const app: Application = express();
app.use(express.json({ limit: "1mb" }));

// Mount routes (order: lightweight first)
registerHealth(app);
registerPrefs(app);
registerCatalog(app);
registerLeads(app);

// Simple root probe
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "buyers-api" });
});

const PORT = Number(process.env.PORT || 8787);
http.createServer(app).listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

export default app;