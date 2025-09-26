// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { getPrefs, prefsSummary } from "../shared/prefs";
import { queryCatalog } from "../shared/catalog"; // returns BuyerRow[]
import type { BuyerRow } from "../shared/catalog";

export const LeadsRouter = Router();

/** Ping */
LeadsRouter.get("/api/leads/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

/**
 * Find buyers for a supplier.
 * Query: host=example.com&region=US/CA&radius=50
 *
 * NOTE: queryCatalog returns BuyerRow[] (not {items}).
 * We enrich rows with a human 'why' string but do not rely
 * on BuyerRow having a 'why' field in its type.
 */
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = String(req.query.host || "").trim().toLowerCase();
    if (!host) {
      return res.status(400).json({ error: "missing host" });
    }

    const region = String(req.query.region || "US/CA");
    const radiusKm = Number(req.query.radius || 50);

    // Effective prefs (city/tier/size bias etc.)
    const prefs = getPrefs(host);

    // Call catalog with the pieces it needs
    const rows: BuyerRow[] = await queryCatalog({
      host,
      region,
      city: prefs.city,
      radiusKm: Number.isFinite(radiusKm) ? radiusKm : prefs.radiusKm,
      tierFocus: prefs.tierFocus,
      categoriesAllow: prefs.categoriesAllow,
      categoriesBlock: prefs.categoriesBlock,
      sizeWeight: prefs.sizeWeight,
      preferSmallMid: prefs.preferSmallMid,
      signalWeight: prefs.signalWeight,
      maxWarm: prefs.maxWarm,
      maxHot: prefs.maxHot,
    } as any);

    // Build explanation once; attach as 'why' in the payload we return.
    const why = prefsSummary(prefs);

    type BuyerOut = BuyerRow & { why?: string };
    const items: BuyerOut[] = (rows || []).map(r => ({ ...(r as any), why }));

    return res.status(200).json({ items });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return res.status(500).json({ error: msg });
  }
});

export default LeadsRouter;