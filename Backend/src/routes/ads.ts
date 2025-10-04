// src/routes/ads.ts
//
// Admin-protected endpoints to ingest and inspect ads intelligence.
// Mount later from index.ts as:   app.use("/api/ads", AdsRouter)
//
// Endpoints:
//   POST /api/ads/upsert   { host, rows: RawAdRow[] } -> upsert for one host
//   POST /api/ads/bulk     { items: [{host, rows: RawAdRow[]}, ...] } -> many
//   GET  /api/ads/:host    -> current AdSignals for a host
//
// Security: require header x-admin-token == process.env.ADMIN_TOKEN

import { Router, Request, Response } from "express";
import {
  upsertAdRows,
  getAdSignalsForHost,
  type RawAdRow,
} from "../shared/ads";

export const AdsRouter = Router();

function assertAdmin(req: Request, res: Response): boolean {
  const want = (process.env.ADMIN_TOKEN || "").trim();
  const got = (req.header("x-admin-token") || "").trim();
  if (!want || got !== want) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function normHost(s?: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

// POST /api/ads/upsert
AdsRouter.post("/upsert", (req: Request, res: Response) => {
  if (!assertAdmin(req, res)) return;

  const host = normHost(req.body?.host);
  const rows: RawAdRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];

  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  if (!rows.length) return res.status(400).json({ ok: false, error: "rows_required" });

  try {
    const sig = upsertAdRows(host, rows);
    return res.json({ ok: true, host, signals: sig });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "ads-upsert-failed", detail: String(e?.message || e) });
  }
});

// POST /api/ads/bulk
AdsRouter.post("/bulk", (req: Request, res: Response) => {
  if (!assertAdmin(req, res)) return;

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  let okCount = 0, errCount = 0;
  const results: any[] = [];

  for (const i of items) {
    const host = normHost(i?.host);
    const rows: RawAdRow[] = Array.isArray(i?.rows) ? i.rows : [];
    if (!host || rows.length === 0) { errCount++; continue; }
    try {
      const sig = upsertAdRows(host, rows);
      okCount++;
      results.push({ host, activeAds: sig.activeAds, lastAdSeenISO: sig.lastAdSeenISO });
    } catch {
      errCount++;
    }
  }
  return res.json({ ok: true, okCount, errCount, results });
});

// GET /api/ads/:host
AdsRouter.get("/:host", (req: Request, res: Response) => {
  if (!assertAdmin(req, res)) return;

  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });

  const sig = getAdSignalsForHost(host);
  if (!sig) return res.json({ ok: true, host, found: false, signals: null });
  return res.json({ ok: true, host, found: true, signals: sig });
});

export default AdsRouter;