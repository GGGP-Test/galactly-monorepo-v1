// src/index.ts
import express from "express";
import cors from "cors";

// Use a single App type everywhere to avoid Express type mismatches
export type App = ReturnType<typeof express>;

import mountLeads from "./routes/leads";
import mountBuyers from "./routes/buyers";
import mountWebscout from "./routes/webscout";
import mountFind from "./routes/find";

const app: App = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Health for Northflank
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// Mount feature routes (all are default exports below)
mountLeads(app);
mountBuyers(app);
mountWebscout(app);
mountFind(app);

// API 404
app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    res.status(404).json({ error: "Not found", path: req.path });
  } else {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

export default app;
