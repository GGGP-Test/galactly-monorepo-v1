// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { loadCatalog, BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary } from "../shared/prefs";

type Temp = "warm" | "hot";

// What we return to the UI
interface ApiItem {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  why: string;
  score: number;
}

const router = Router();

// --- helper: light scoring & city preference ---
function scoreRow(r: BuyerRow, city?: string): number {
  let s = 70; // base
  if (city) {
    const c = city.toLowerCase();
    if (r.cityTags?.some(t => t.toLowerCase() === c)) s += 12;
    else if (r.cityTags?.some(t => t.toLowerCase().includes(c))) s += 6;
  }
  // Nudge for being tagged as SMB-ish in catalog tags
  if (r.tags?.some(t => ["indie","smb","boutique","local"].includes(t))) s += 5;
  // Avoid huge brands by a small negative if tagged
  if (r.tags?.some(t => ["mega","enterprise"].includes(t))) s -= 10;
  return s;
}

function toApiItem(r: BuyerRow, why: string, city?: string): ApiItem {
  return {
    host: r.host,
    platform: "web",
    title: r.name ? `Suppliers / vendor info | ${r.name}` : "Suppliers / vendor info",
    created: new Date().toISOString(),
    temp: "warm",
    why,
    score: Math.max(0, Math.min(100, scoreRow(r, city))),
  };
}

// GET /api/leads/find-buyers?host=example.com&region=US%2FCA&radius=50%20mi&city=Los%20Angeles
router.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const hostParam = String(req.query.host || "");
    if (!hostParam) {
      res.status(400).json({ error: "missing host" });
      return;
    }

    // read current prefs; allow temporary city override via query
    let p = getPrefs(hostParam);
    const cityOverride = typeof req.query.city === "string" ? req.query.city : undefined;
    if (cityOverride || req.query.radius) {
      p = setPrefs(hostParam, {
        city: cityOverride ?? p.city,
        radiusKm: req.query.radius ? Number(String(req.query.radius).replace(/[^0-9.]/g, "")) || p.radiusKm : p.radiusKm,
      });
    }

    // Load catalog once; it returns a LoadedCatalog object
    const loaded = await loadCatalog();
    const rows: BuyerRow[] = loaded.items || [];

    // Apply very light preference filtering (category allow/block)
    const allow = new Set((p.categoriesAllow || []).map(s => s.toLowerCase()));
    const block = new Set((p.categoriesBlock || []).map(s => s.toLowerCase()));
    const passes = (r: BuyerRow) => {
      const tags = (r.tags || []).map(t => t.toLowerCase());
      if (block.size && tags.some(t => block.has(t))) return false;
      if (allow.size && !tags.some(t => allow.has(t))) return false;
      // Prefer Tier C by default: keep everything, but we’ll sort so C floats up
      return true;
    };

    // Sorter: 1) city, 2) Tier C preference, 3) score
    const city = p.city;
    const tierRank = (r: BuyerRow) => {
      const ts = r.tiers || [];
      if (ts.includes("C" as any)) return 0;
      if (ts.includes("B" as any)) return 1;
      if (ts.includes("A" as any)) return 2;
      return 3;
    };

    const whyPrefix = `fit: ${prefsSummary(p)}`;

    const filtered = rows
      .filter(passes)
      .map(r => ({ row: r, s: scoreRow(r, city) }))
      .sort((a, b) => {
        // city match first
        const aCity = city && a.row.cityTags?.some(t => t.toLowerCase() === city.toLowerCase()) ? 0 : 1;
        const bCity = city && b.row.cityTags?.some(t => t.toLowerCase() === city.toLowerCase()) ? 0 : 1;
        if (aCity !== bCity) return aCity - bCity;

        // tier bias: C, B, A
        const trA = tierRank(a.row);
        const trB = tierRank(b.row);
        if (trA !== trB) return trA - trB;

        // score desc
        return b.s - a.s;
      })
      .map(({ row }) => toApiItem(row, whyPrefix, city));

    // Cap counts using prefs
    const warm = filtered.slice(0, p.maxWarm || 5);

    // (We’ll add real “hot” detection later; keeping a placeholder empty list for now)
    const hot: ApiItem[] = [];

    res.json({ items: [...hot, ...warm] });
  } catch (err: any) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;