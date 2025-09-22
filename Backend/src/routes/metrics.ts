// src/routes/metrics.ts
import { Router, Request, Response } from "express";
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  buckets,
  watchers as getWatchers,
  Temp,
  StoredLead,
} from "../shared/memStore";

export const metricsRouter = Router();

// health for this router
metricsRouter.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// GET /api/v1/metrics/watchers?host=example.com
metricsRouter.get("/watchers", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });

  const w = getWatchers(host); // arrays (so .length works)
  res.json({
    ok: true,
    host,
    counts: { watchers: w.watchers.length, competitors: w.competitors.length },
    watchers: w.watchers,
    competitors: w.competitors,
  });
});

// GET /api/v1/metrics/buckets
metricsRouter.get("/buckets", (_req: Request, res: Response) => {
  res.json({ ok: true, ...buckets() });
});

// POST /api/v1/metrics/claim
// body: { host, title?, platform?, why?, temperature? }
metricsRouter.post("/claim", (req: Request, res: Response) => {
  const { host, title, platform, why, temperature } = req.body ?? {};
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });

  // make sure a lead exists, then update it
  ensureLeadForHost(host);

  const patch: Partial<StoredLead> = {
    title,
    platform,
    why,
    saved: true,
  };

  // optional temperature bump
  const t: Temp | undefined =
    temperature === "hot" || temperature === "warm" || temperature === "cold"
      ? temperature
      : undefined;
  if (t) patch.temperature = t;

  const updated = saveByHost(host, patch);
  return res.json({ ok: true, lead: updated });
});

// GET /api/v1/metrics/hot?host=...
metricsRouter.get("/hot", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = replaceHotWarm(host, "hot");
  res.json({ ok: true, lead });
});

// GET /api/v1/metrics/warm?host=...
metricsRouter.get("/warm", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = replaceHotWarm(host, "warm");
  res.json({ ok: true, lead });
});

// GET /api/v1/metrics/reset?host=...
metricsRouter.get("/reset", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });
  const lead = resetHotWarm(host);
  res.json({ ok: true, lead });
});

// GET /api/v1/metrics/deepen?host=...
// If you don’t have anything extra to add right now, return a
// deliberate 404 with a friendly payload (the UI shows a small warning).
metricsRouter.get("/deepen", (req: Request, res: Response) => {
  const host = (req.query.host as string) || "";
  if (!host) return res.status(400).json({ ok: false, error: "missing host" });

  // Hook point: add enrichment here. For now, nothing additional.
  return res.status(404).json({ ok: false, error: "nothing to deepen" });
});

export default metricsRouter;