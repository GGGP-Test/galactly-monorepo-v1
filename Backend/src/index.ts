// Backend/src/index.ts
import express from "express";
import cors from "cors";
import { mountLeads } from "./routes/leads";

const app = express();

// basic middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// root + health
app.get("/", (_req, res) => res.status(200).send("ok"));
// /healthz is also registered inside mountLeads, but keeping root helps quick checks

// IMPORTANT: just call the function; do NOT pass its return into app.use(...)
mountLeads(app);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  console.log(`[api] listening on ${PORT}`);
});
