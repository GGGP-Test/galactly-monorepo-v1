import express from "express";
import cors from "cors";
import pino from "pino";

const log = pino({ transport: { target: "pino-pretty" } });
const app = express();

app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

/**
 * Temporary stub endpoint. Your front-end can hit this now.
 * We'll swap in the real lead-finder once the pipeline is green.
 */
app.post("/api/v1/leads/find-buyers", async (req, res) => {
  const { supplierDomain, personaHint } = req.body ?? {};
  log.info({ supplierDomain, personaHint }, "find-buyers called");

  // Minimal, valid shape so the UI can render something:
  res.json({
    supplierDomain,
    persona: {
      oneLiner: personaHint
        ? `${supplierDomain} sells X to Y; best contact is Z`
        : `You sell X to Y; best contact is Z`
    },
    leads: [],
    status: "ok"
  });
});

const PORT = parseInt(process.env.PORT ?? "8787", 10);
app.listen(PORT, "0.0.0.0", () => {
  log.info({ PORT }, "Backend up");
});
