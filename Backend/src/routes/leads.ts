// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { getPrefs, prefsSummary, normalizeHost, EffectivePrefs } from "../shared/prefs";
import { queryCatalog, BuyerRow } from "../shared/catalog";

export const LeadsRouter = Router();

/**
 * Health ping for this route-set (handy for Docker healthcheck chaining)
 */
LeadsRouter.get("/api/leads/health", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

/**
 * Find buyers for a supplier host.
 *
 * Query params:
 *   - host (required): supplier website (domain or URL)
 *   - region (optional): "US/CA" etc. (currently informational)
 *   - radius (optional): "50 mi" etc. (currently informational)
 */
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const hostParam = String(req.query.host || "").trim();
    if (!hostParam) {
      res.status(400).json({ error: "host is required" });
      return;
    }
    const host = normalizeHost(hostParam);

    // Load effective prefs (city bias, tier focus, size weighting, etc.)
    const prefs: EffectivePrefs = getPrefs(host);

    // Build a simple query for the catalog
    const q = {
      host,                         // used for logging/scoring context
      city: prefs.city,             // optional city bias
      tiers: prefs.tierFocus,       // e.g. ["C","B"]
      allow: prefs.categoriesAllow, // tags/categories to prefer
      block: prefs.categoriesBlock, // tags/categories to avoid
      preferSmallMid: prefs.preferSmallMid,
      sizeWeight: prefs.sizeWeight,
      limit: Math.max(5, (prefs.maxWarm || 5) + (prefs.maxHot || 1) + 5),
    } as const;

    // Ask the catalog to produce candidates
    const out = await queryCatalog(q);

    // Normalize to the Free Panel table shape
    const nowIso = new Date().toISOString();
    const items = (out.items || out || []).slice(0, prefs.maxWarm || 5).map((row: BuyerRow) =>
      rowToResult(row, prefs, nowIso)
    );

    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err || "unknown") });
  }
});

/* ------------------------- helpers ------------------------- */

function rowToResult(row: BuyerRow, prefs: EffectivePrefs, createdIso: string) {
  // Title (stable and readable)
  const title = `Suppliers / vendor info | ${row.name || row.host}`;

  // Temperature: prefer "warm" by default; nudge to "hot" if tier C + strong city match
  const isTierC = Array.isArray(row.tiers) && row.tiers.includes("C" as any);
  const cityHit =
    !!prefs.city &&
    Array.isArray(row.cityTags) &&
    row.cityTags.map(safeLower).includes(safeLower(prefs.city));

  const temp: "warm" | "hot" = isTierC && cityHit ? "hot" : "warm";

  // Human "why" (we synthesize; BuyerRow has no 'why' field)
  const seg = Array.isArray(row.segments) && row.segments.length ? row.segments.join(" · ") : "general packaging";
  const tierTxt = Array.isArray(row.tiers) && row.tiers.length ? `tier: ${row.tiers.join("/")}` : "tier: n/a";
  const cityTxt = prefs.city ? (cityHit ? `city match: ${prefs.city}` : `city bias: ${prefs.city}`) : "city: n/a";
  const why = `${seg} • ${tierTxt} • ${cityTxt} • ${prefsSummary(prefs)}`;

  return {
    host: row.host,
    platform: "web",
    title,
    created: createdIso,
    temp,
    why,
  };
}

function safeLower(s: any): string {
  return String(s || "").trim().toLowerCase();
}