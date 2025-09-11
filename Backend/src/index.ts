import express, { Application } from "express";
import cors from "cors";
import { mountLeads } from "./routes/leads"; // named export

const app: Application = express();

// basic middleware
app.use(cors());
app.use(express.json());

// health/readiness
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// simple root
app.get("/", (_req, res) => res.send("ok"));

// mount routes
mountLeads(app); // registers /api/v1/leads and friends

// start server (Northflank maps container port)
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);
});

export default app;
