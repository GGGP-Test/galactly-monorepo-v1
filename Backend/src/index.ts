import express from "express";
import cors from "cors";
import { mountLeads } from "./routes/leads";

const app = express();

// JSON + forms
app.use(cors()); // keep if panel is on a different domain; otherwise you can remove
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Health for Northflank
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "packlead-runtime" });
});

// Mount lead routes (base path is handled inside mountLeads)
mountLeads(app);

// 404 guard
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`packlead runtime listening on :${PORT}`);
});
