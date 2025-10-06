// src/routes/ads.ts
//
// Admin-protected endpoints to ingest and inspect ads intelligence.
// Mount in index.ts as:  app.use("/api/ads", AdsRouter)

import { Router, Request, Response } from "express";
import { requireAdmin } from "../shared/admin";
import {
  upsertHost,
  upsertBulk,
  getStats,
  getSignal,
  type AdRow,
} from "../shared/ads-store";

export const AdsRouter = Router();

function normHost(s?: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// POST /api/ads/upsert  { host, rows: AdRow[] }
AdsRouter.post("/upsert", requireAdmin, (req: Request, res: Response) => {
  const host = normHost(req.body?.host);
  const rows: AdRow[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });
  if (!rows.length) return res.status(400).json({ ok: false, error: "rows_required" });

  try {
    upsertHost(host, rows);
    const stats = getStats(host);
    const signal = getSignal(host);
    return res.json({ ok: true, host, stats, signal });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "ads-upsert-failed", detail: String(e?.message || e) });
  }
});

// POST /api/ads/bulk  { items:[{host, rows}, ...] }
AdsRouter.post("/bulk", requireAdmin, (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ ok: false, error: "items_required" });

  try {
    const inserted = upsertBulk({ items });
    // quick summary per host (optional)
    const results = items.map((it: any) => {
      const h = normHost(it?.host);
      if (!h) return null;
      const s = getStats(h);
      return { host: h, lastSeen: s.lastSeen, recentCount: s.densityLast30, signal: getSignal(h) };
    }).filter(Boolean);

    return res.json({ ok: true, inserted, results });
  } catch (e: any) {
    return res.status(200).json({ ok: false, error: "ads-bulk-failed", detail: String(e?.message || e) });
  }
});

// GET /api/ads/:host -> stats + signal
AdsRouter.get("/:host", requireAdmin, (req: Request, res: Response) => {
  const host = normHost(req.params.host);
  if (!host) return res.status(400).json({ ok: false, error: "host_required" });

  const stats = getStats(host);
  const signal = getSignal(host);
  return res.json({ ok: true, host, stats, signal });
});

export default AdsRouter;