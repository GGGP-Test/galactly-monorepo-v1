import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8787);

// Northflank health
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Stub for the lead-finder endpoint; returns shape, not empty 500s
app.post("/api/v1/leads/find-buyers", async (req, res) => {
  const { supplierDomain, oneLiner, personaHint } = req.body ?? {};
  res.json({
    ok: true,
    supplierDomain: supplierDomain ?? null,
    personaHint: personaHint ?? null,
    oneLiner: oneLiner ?? null,
    buyers: [], // populated by discovery pipeline later
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on ${PORT}`);
});
