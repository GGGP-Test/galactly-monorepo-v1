// src/routes/metrics.ts
import { Router } from "express";
import { saveByHost, buckets, Temp } from "../shared/memStore";

const router = Router();

// simple health/ping for the metrics group
router.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Panel pings this with host=news.google.com etc. We just ACK it.
router.get("/watchers", (req, res) => {
  const host = String(req.query.host ?? "");
  return res.json({ ok: true, host, viewers: 1 });
});

// Called when user clicks “Lock & keep”
router.post("/claim", (req, res) => {
  const body = req.body || {};
  const host = String(body.host || req.query.host || body.domain || "");
  const temp: Temp = String(body.temp || "warm").toLowerCase() === "hot" ? "hot" : "warm";
  if (!host) return res.status(400).json({ ok: false, error: "host required" });

  const saved = saveByHost(temp, {
    host,
    title: body.title,
    platform: body.platform,
    whyText: body.whyText,
    why: body.why,
  });

  return res.json({ ok: true, saved, counts: { hot: buckets.hot.length, warm: buckets.warm.length } });
});

// Called when user clicks “Deepen results” (no-op stub that succeeds)
router.get("/deepen", (req, res) => {
  const host = String(req.query.host || "");
  return res.json({ ok: true, host, added: 0 });
});

export default router;