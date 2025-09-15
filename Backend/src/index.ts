import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();

// Core middleware
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: true })); // allow GitHub Pages, Codex env, etc.

// Explicit preflight handler (no app.options errors)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  return next();
});

// Health
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// API routes
app.use("/api/v1/leads", leadsRouter);

// Start
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`[server] listening on :${port}`));

export default app;