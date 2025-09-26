// src/index.ts
import express from "express";
import cors from "cors";
import morgan from "morgan";

// Import each router exactly once (default imports)
import LeadsRouter from "./routes/leads";
import PrefsRouter from "./routes/prefs";

const app = express();
app.disable("x-powered-by");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health probes (used by Dockerfile CMD healthcheck)
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// API routes
app.use("/api/leads", LeadsRouter());
app.use("/api/prefs", PrefsRouter());

// Simple root
app.get("/", (_req, res) => res.status(200).send("buyers-api ok"));

const PORT = Number(process.env.PORT) || 8787;

// Only start the server when this file is the entrypoint
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`buyers-api listening on :${PORT}`);
  });
}

export default app;