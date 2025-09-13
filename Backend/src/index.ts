// src/index.ts
import express from "express";
import leadsRouter from "./routes/leads";

const app = express();

// Parse JSON once, globally
app.use(express.json({ limit: "1mb" }));

// Mount our bullet-proof router (contains /api/v1/... and non-prefixed paths)
app.use(leadsRouter);

// Optional: minimal root + health for quick checks
app.get("/", (_req, res) => res.status(200).send("ok"));
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// Final catch-all (non-API): return 404 text to avoid confusing proxies
app.use((req, res) => res.status(404).send("not found"));

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});