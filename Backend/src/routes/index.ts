import { Router } from "express";
import metricsRouter from "./metrics";
// IMPORTANT: this must exist in your repo. If your leads router file is named
// differently, rename the import below to match (e.g. "./leads", "./buyers", etc.)
import leadsRouter from "./leads";

// Optional: if you have a separate health router file, import and use it.
// Otherwise we expose a simple healthz here.
const router = Router();

// health
router.get("/healthz", (_req, res) => res.json({ ok: true }));

// metrics (our minimal stub you’re already using)
router.use("/metrics", metricsRouter);

// leads (this is what your Free Panel calls)
router.use("/leads", leadsRouter);

// Backward-compat alias in case any older panel points here:
router.use("/buyers", leadsRouter);

export default router;