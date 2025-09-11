// Backend/src/index.ts
import express from "express";
import { mountLeads } from "./routes/leads";
import { requireApiKey } from "./auth";

const app = express();

// Minimal CORS (no extra deps)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Body parser
app.use(express.json({ limit: "1mb" }));

// Health & ping (no auth)
app.get("/health", (_req, res) => res.status(200).type("text/plain").send("ok"));
app.get("/ping", (_req, res) => res.status(200).json({ ok: true, time: new Date().toISOString() }));

// API routes
mountLeads(app, { requireApiKey });

// Start server
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on :${port}`);
});

export default app;
