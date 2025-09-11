import express, { Request, Response } from "express";
import cors from "cors";
import { json, urlencoded } from "express";
import { mountLeads } from "./routes/leads";

const app = express();

// Basic hardening + JSON
app.use(cors()); // you can remove this if you host panel + API on same domain
app.use(json({ limit: "1mb" }));
app.use(urlencoded({ extended: true }));

// Health for Northflank
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "packlead-runtime" });
});

// Mount all lead routes at /api/v1/leads
mountLeads(app, "/api/v1/leads");

// 404 guard (helps you see wrong paths)
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`packlead runtime listening on :${PORT}`);
});
