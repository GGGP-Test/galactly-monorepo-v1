import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";
import mountBuyerRoutes from "./routes/buyers";

const app = express();

// CORS + JSON (no app.options(...))
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

// API
app.use("/api/v1/leads", leadsRouter);

// Start
const app = express();
app.use(express.json());
mountBuyerRoutes(app);

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(JSON.stringify({ msg: "server_started", port: PORT }));
});

export default app;
