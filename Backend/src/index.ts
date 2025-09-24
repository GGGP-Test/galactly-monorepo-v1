import express from "express";
import cors from "cors";
import leads from "./routes/leads";
import ingest from "./routes/ingest";

// --- tiny health & compat shim kept for the panel ---
type ApiOk = { ok: true };
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// mount our APIs
app.use("/api", leads);
app.use("/api", ingest);

// legacy “compat” find endpoint so the panel’s old buttons still work
app.get(["/leads/find-buyers","/buyers/find-buyers","/find-buyers"], (req, res) => {
  const host = String(req.query.host ?? "").trim().toLowerCase() || "peekpackaging.com";
  const body = {
    ok: true,
    items: [
      {
        host,
        platform: "web",
        title: `Buyer lead for ${host}`,
        created: new Date().toISOString(),
        temp: "warm",
        whyText: `Compat shim matched (${req.query.region ?? "US/CA"}, ${req.query.radius ?? "50 mi"})`,
      },
    ],
  };
  res.json(body);
});

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`buyers-api listening on :${PORT}`);
});