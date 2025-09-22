// src/routes/metrics.ts
import { Router } from "express";
import {
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
  buckets as bucketize,
  watchers as getWatcherInfo,
  type Temp,
} from "../shared/memStore";

type Ok<T = Record<string, unknown>> = { ok: true } & T;
type Err = { ok: false; error: string };

export const metricsRouter = Router();

// simple health for Dockerfile's HEALTHCHECK and smoke tests
metricsRouter.get("/healthz", (_req, res) => {
  const b = bucketize();
  res.json({ ok: true, cold: b.cold.length, warm: b.warm.length, hot: b.hot.length } satisfies Ok());
});

// return watcher/competitor counts for a host
// GET /api/v1/metrics/watchers?host=news.google.com
metricsRouter.get("/watchers", (req, res) => {
  const host = String(req.query.host ?? "");
  if (!host) return res.status(400).json({ ok: false, error: "missing host" } satisfies Err);

  const { watchers, competitors } = getWatcherInfo(host);
  res.json({ ok: true, watchers: watchers.length, competitors: competitors.length } satisfies Ok);
});

// mark a lead as claimed/saved by host (panel hits this)
// POST /api/v1/metrics/claim  { host: "news.google.com" }
metricsRouter.post("/claim", (req, res) => {
  const host = String(req.body?.host ?? "");
  if (!host) return res.status(400).json({ ok: false, error: "missing host" } satisfies Err);

  const lead = ensureLeadForHost(host);
  // touch the lead so it appears in lists and has a created timestamp
  saveByHost(host, { created: lead.created });

  res.json({ ok: true } satisfies Ok);
});

// deepen a lead: nudge temperature or enrich minimal info
// GET /api/v1/metrics/deepen?host=news.google.com&to=warm|hot|cold
metricsRouter.get("/deepen", (req, res) => {
  const host = String(req.query.host ?? "");
  if (!host) return res.status(400).json({ ok: false, error: "missing host" } satisfies Err);

  const to = String(req.query.to ?? "warm") as Temp | "reset";
  const lead = ensureLeadForHost(host);

  let newTemp: Temp;
  if (to === "reset") {
    newTemp = resetHotWarm(host).temperature ?? "cold";
  } else {
    newTemp = replaceHotWarm(host, to).temperature ?? "cold";
  }

  res.json({ ok: true, host, temperature: newTemp } satisfies Ok);
});

// buckets: quick counters for UI badges
// GET /api/v1/metrics/buckets
metricsRouter.get("/buckets", (_req, res) => {
  const b = bucketize();
  res.json({
    ok: true,
    hot: b.hot.length,
    warm: b.warm.length,
    cold: b.cold.length,
  } satisfies Ok);
});

export default metricsRouter; // (harmless if imported by name; keeps both options working)