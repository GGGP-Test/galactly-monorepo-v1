// src/index.ts
import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();

// middleware
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));

// healthcheck (Dockerfile probes /healthz)
app.get("/healthz", (_req, res) => res.type("text/plain").send("ok"));

// api
app.use("/api/leads", leadsRouter);

// root (basic ping)
app.get("/", (_req, res) => res.json({ ok: true, service: "buyers-api" }));

// start
const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[buyers-api] listening on http://0.0.0.0:${PORT}`);
});
