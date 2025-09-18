import express from "express";
import cors from "cors";
import leadsRouter from "./routes/leads";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "buyers", ts: new Date().toISOString() }));

app.use("/api/v1/leads", leadsRouter);

app.get("/", (_req, res) => res.status(200).send("OK"));

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`[server] listening on :${port}`);
});
