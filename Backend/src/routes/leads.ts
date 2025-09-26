// src/routes/leads.ts
import { Router, type Request, type Response } from "express";
import {
  getPrefs,
  prefsSummary,
  normalizeHost,
  type EffectivePrefs,
} from "../shared/prefs";

// Catalog is versioned/evolving; import defensively
// We only rely on shape-like fields when present.
import * as Cat from "../shared/catalog";

// What the UI expects from this route
type Temp = "warm" | "hot";
type Lead = {
  host: string;
  platform: "web";
  title: string;
  created: string;        // ISO timestamp
  temp: Temp;
  score: number;
  why: string;            // human-readable reasoning
};

// Try to call whichever catalog query function exists,
// falling back to a raw array of rows if needed.
function queryCatalogSafe(p: EffectivePrefs): any[] {
  const limit = Math.max(1, (p.maxWarm ?? 5) + (p.maxHot ?? 1));
  const fn =
    (Cat as any).queryCatalog ||
    (Cat as any).searchCatalog ||
    (Cat as any).search ||
    (Cat as any).getRows ||
    (Cat as any).all ||
    (() => (Cat as any).rows || []);

  try {
    const rows = fn({
      city: p.city,
      tierFocus: p.tierFocus,
      categoriesAllow: p.categoriesAllow,
      categoriesBlock: p.categoriesBlock,
      preferSmallMid: p.preferSmallMid,
      sizeWeight: p.sizeWeight,
      limit,
    });
    if (Array.isArray(rows)) return rows;
    if (Array.isArray(rows?.items)) return rows.items;
    return [];
  } catch {
    const rows = (Cat as any).rows || [];
    return Array.isArray(rows) ? rows : [];
  }
}

// Very light scoring with strong bias to Tier C + local + size prefs.
// (We’ll enrich this later with signals and time-based hotness.)
function scoreRow(row: any, p: EffectivePrefs): number {
  let s = 0;

  // Tier bias
  if (Array.isArray(row?.tiers)) {
    if (row.tiers.includes("C")) s += 30;
    if (row.tiers.some((t: string) => p.tierFocus.includes(t))) s += 10;
  }

  // City/locality
  if (p.city) {
    const city = String(p.city).toLowerCase();
    const inCity =
      (Array.isArray(row?.cityTags) && row.cityTags.some((c: string) => String(c).toLowerCase() === city)) ||
      String(row?.city).toLowerCase() === city ||
      String(row?.hqCity).toLowerCase() === city;
    if (inCity) s += 40 * (p.signalWeight.local ?? 1);
  }

  // Size weighting
  if (row?.size && p.sizeWeight && p.sizeWeight[row.size as keyof typeof p.sizeWeight] != null) {
    s += Number(p.sizeWeight[row.size as keyof typeof p.sizeWeight]) * 10;
  } else if (p.preferSmallMid) {
    // Default nudge if size unknown
    s += 6;
  }

  // Category allow/block simple nudges
  const segs: string[] = (Array.isArray(row?.segments) ? row.segments : []).map((x: any) =>
    String(x || "").toLowerCase(),
  );
  if (p.categoriesAllow.length && segs.some((s0) => p.categoriesAllow.includes(s0))) s += 5;
  if (p.categoriesBlock.length && segs.some((s0) => p.categoriesBlock.includes(s0))) s -= 8;

  return Math.round(s * 10) / 10;
}

function tempFromScore(score: number): Temp {
  return score >= 60 ? "hot" : "warm";
}

function makeTitle(row: any): string {
  const name = row?.name || row?.brand || row?.host || row?.domain || "Buyer";
  return `Suppliers / vendor info | ${name}`;
}

function reason(row: any, p: EffectivePrefs, score: number): string {
  const bits: string[] = [];

  if (Array.isArray(row?.tiers) && row.tiers.length) {
    bits.push(`tier: ${row.tiers.join("/")}`);
  }
  if (p.city) bits.push(`city preference: ${p.city}`);
  if (row?.size) bits.push(`size: ${row.size}`);
  if (Array.isArray(row?.segments) && row.segments.length) {
    bits.push(`segments: ${row.segments.slice(0, 3).join(",")}${row.segments.length > 3 ? "…" : ""}`);
  }

  bits.push(`prefs • ${prefsSummary(p)}`);
  bits.push(`score=${score}`);
  return bits.join(" · ");
}

const router = Router();

/**
 * GET /api/leads/find-buyers?host=stretchandshrink.com&region=US%2FCA&radius=50%20mi
 * Responds with { items: Lead[] } sorted by score, capped by user prefs.
 */
router.get("/find-buyers", (req: Request, res: Response) => {
  const hostQ = String(req.query.host || "");
  const host = normalizeHost(hostQ);
  if (!host) {
    return res.status(400).json({ ok: false, error: "missing host query param" });
  }

  // Load effective prefs (bias to Tier C + local + small/mid by default)
  const p = getPrefs(host);

  // Pull candidate rows from catalog using our safe adapter
  const rows = queryCatalogSafe(p);

  // Score → map to Lead → sort
  const scored: Lead[] = rows
    .map((row: any) => {
      const s = scoreRow(row, p);
      const t = tempFromScore(s);
      return {
        host: String(row?.host || row?.domain || ""),
        platform: "web",
        title: makeTitle(row),
        created: new Date().toISOString(),
        temp: t,
        score: s,
        why: reason(row, p, s),
      } as Lead;
    })
    // ensure host present
    .filter((r) => r.host);

  scored.sort((a, b) => b.score - a.score);

  // honor caps: hot first, then warm
  const hot = scored.filter((x) => x.temp === "hot").slice(0, p.maxHot ?? 1);
  const warm = scored.filter((x) => x.temp === "warm").slice(0, p.maxWarm ?? 5);
  const items = [...hot, ...warm];

  return res.json({ items });
});

export default router;