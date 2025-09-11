import express from "express";
import { mountLeads } from "./routes/leads"; // mountLeads(app) — takes ONE arg

const app = express();

// Tiny CORS so GitHub Pages panel can talk to the API
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

// Health & ping (used by Northflank)
app.get("/health", (_req, res) => res.status(200).type("text/plain").send("ok"));
app.get("/ping", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// API routes
mountLeads(app); // <-- single argument

// Start
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Backend listening on :${port}`));

export default app;
