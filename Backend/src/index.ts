/**
 * PackLead API entrypoint
 * - Health:        GET /healthz
 * - Leads routes:  mounted under /api/v1
 */

import express, { Express, Request, Response, NextFunction } from "express";
import { mountLeads } from "./routes/leads";

const app: Express = express();

// Minimal CORS (avoid bringing extra deps into the build)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "packlead", base: "/api/v1" });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Mount feature routes
mountLeads(app, "/api/v1");

// Start server (Northflank defaults to 8787)
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // keep this console.log; Northflank shows it in logs and it's useful
  console.log(`PackLead API listening on :${PORT}`);
});
