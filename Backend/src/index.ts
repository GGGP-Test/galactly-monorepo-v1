import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";

/**
 * We import as namespaces so this file works whether each module
 * exports a named `mountX` function or a default export.
 */
import * as leadsMod from "./routes/leads";
import * as buyersMod from "./routes/buyers";
import * as findMod from "./routes/find";

// ---------- helpers ----------

function pickMount(mod: any, key: string) {
  // Prefer named export (mountLeads / mountBuyers / mountFind).
  if (mod && typeof mod[key] === "function") return mod[key];
  // Fallback to default export if it’s a function.
  if (mod && typeof mod.default === "function") return mod.default;
  // No-op to avoid crashes if a module is temporarily absent.
  return (_app: Application) => {};
}

const mountLeads = pickMount(leadsMod, "mountLeads") as (app: Application) => void;
const mountBuyers = pickMount(buyersMod, "mountBuyers") as (app: Application) => void;
const mountFind = pickMount(findMod, "mountFind") as (app: Application) => void;

const PORT = Number(process.env.PORT || 8787);

const app: Application = express();

// Basic hardening & parsing
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health/readiness
app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));
app.get("/", (_req: Request, res: Response) => res.status(200).json({ ok: true, service: "packLead-runtime" }));

// Mount API routes (all use Application type to avoid Express-vs-Application generic mismatch)
mountLeads(app);   // e.g. /api/v1/leads, /api/v1/leads/ingest, etc.
mountBuyers(app);  // e.g. /api/v1/leads/find-buyers
mountFind(app);    // optional extra find endpoints if present

// 404 JSON
app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// Error handler (keeps JSON shape consistent)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    ok: false,
    error: err?.message || "Internal Server Error",
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[packLead] listening on :${PORT}`);
});

export default app;
