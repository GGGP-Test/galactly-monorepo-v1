import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();

// basics
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// health
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// --- IMPORTANT: mount the leads router on both prefixes ---
// If routes/leads.ts defines router.get("/find-buyers"), this makes:
//   /api/leads/find-buyers   and   /api/find-buyers
// If it defines router.get("/leads/find-buyers"), this still makes:
//   /api/leads/find-buyers   work.
app.use("/api/leads", leadsRouter);
app.use("/api", leadsRouter);

// 404 catcher (helps debug)
app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    method: req.method,
    path: req.originalUrl,
  });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`buyers-api listening on http://127.0.0.1:${port}`);
});