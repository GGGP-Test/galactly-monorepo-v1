import express from "express";
import cors from "cors";
import mountLeads from "./routes/leads";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (_req, res) => res.send("ok"));

app.use(mountLeads());

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on :${PORT}`);
});
