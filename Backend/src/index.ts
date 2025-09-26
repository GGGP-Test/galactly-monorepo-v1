// src/index.ts
import express, { type Router } from "express";
import cors from "cors";
import morgan from "morgan";

// Import whatever the modules export (router instance OR factory)
import leadsModule from "./routes/leads";
import prefsModule from "./routes/prefs";

/**
 * Accepts either:
 *  - an Express Router instance, or
 *  - a zero-arg factory that returns a Router.
 * Returns a Router in both cases.
 */
function asRouter(mod: any): Router {
  // Express Router instances are functions with length 3 (req,res,next)
  // A zero-arg factory has length 0; call it to obtain the Router.
  if (typeof mod === "function" && mod.length === 0) {
    const r = mod();
    return r as Router;
  }
  return mod as Router;
}

const app = express();
app.disable("x-powered-by");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health endpoints (Docker healthcheck uses these)
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

// Normalize routers regardless of export style
const LeadsRouter = asRouter(leadsModule);
const PrefsRouter = asRouter(prefsModule);

// Wire routes
app.use("/api/leads", LeadsRouter);
app.use("/api/prefs", PrefsRouter);

// Root
app.get("/", (_req, res) => res.status(200).send("buyers-api ok"));

const PORT = Number(process.env.PORT) || 8787;

// Only start server when run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`buyers-api listening on :${PORT}`);
  });
}

export default app;