// src/routes/leads.ts
//
// Finds buyer leads by combining our env-backed catalog with optional
// Google Places SMB discovery (real websites) when a city is provided.
// - Accepts BuyerRow[] | {rows} | {items}
// - No mutation of source rows
// - Explicit types (noImplicitAny safe)
// - Provides both named and default export
//
// Query params (subset used by Free Panel):
//   host=...               supplier host (key for prefs)
//   city=...               boosts locality + triggers Places enrichment
//   radiusKm=...           saved in prefs (optional)
//   categories=csv         optional override for Places categories
//   limit=n                soft cap for Places fetch (final warm/hot still
//                          governed by prefs.maxWarm / prefs.maxHot)

import { Router, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags } from "../shared/trc";
import { fetchPlacesBuyers } from "../shared/places";

export const LeadsRouter = Router();

/** safe query getter */
function q(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown> | undefined)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function intersects(a: string[] = [], b: string[] = []): boolean {
  if (!a.length || !b.length) return false;
  const set = new Set(a.map((x) => x.toLowerCase()));
  return b.some((x) => set.has(String(x).toLowerCase()));
}

function hasBlockedTags(prefs: EffectivePrefs, tags: string[]): boolean {
  return prefs.categoriesBlock.length ? intersects(prefs.categoriesBlock, tags) : false;
}
function passesAllowTags(prefs: EffectivePrefs, tags: string[]): boolean {
  return prefs.categoriesAllow.length ? intersects(prefs.categoriesAllow, tags) : true;
}

function tierPass(prefs: EffectivePrefs, rowTiers?: ReadonlyArray<string>): boolean {
  if (!prefs.tierFocus?.length) return true;
  if (!rowTiers?.length) return true;
  const want = new Set<string>(prefs.tierFocus.map(String));
  for (const t of rowTiers) if (want.has(String(t))) return true;
  return false;
}

/** Normalize whatever loadCatalog() returns to BuyerRow[] without depending on its TS type */
function toArrayMaybe(cat: unknown): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

/** Deduplicate rows by host (case-insensitive) while preserving first occurrence. */
function dedupeByHost(rows: BuyerRow[]): BuyerRow[] {
  const out: BuyerRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const h = String((r as any).host || "").toLowerCase();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(r);
  }
  return out;
}

type Temp = "warm" | "hot";
interface LeadItem {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  score: number;
  why: string;
}

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "";
    const city = q(req, "city");
    const radiusQ = q(req, "radiusKm");
    const radius = radiusQ != null ? Number(radiusQ) : NaN;

    // Optional Places overrides
    const categoriesCsv = q(req, "categories");
    const limitQ = q(req, "limit");
    const limit = limitQ ? Number(limitQ) : NaN;

    let prefs = getPrefs(supplierHost);
    if (city || Number.isFinite(radius)) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    // 1) Base catalog (env-backed)
    const catalog = await loadCatalog();
    const baseRows: BuyerRow[] = toArrayMaybe(catalog);

    // 2) Optional Google Places SMB discovery (only when we have city + API key)
    const havePlacesKey = Boolean((process.env.GOOGLE_PLACES_API_KEY || "").trim());
    let placesRows: BuyerRow[] = [];
    if (havePlacesKey && city) {
      const cats = categoriesCsv
        ? categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
      const placesLimitEnv = Number(process.env.PLACES_LIMIT_DEFAULT || "");
      const want = Number.isFinite(limit) && limit > 0 ? limit : (Number.isFinite(placesLimitEnv) ? placesLimitEnv : 25);
      placesRows = await fetchPlacesBuyers({ city, categories: cats, limit: want });
    }

    // Merge + de-dupe
    const mergedRows = dedupeByHost([...baseRows, ...placesRows]);

    // Candidate filtering using prefs
    const candidates: BuyerRow[] = mergedRows.filter((row: BuyerRow) => {
      const tags = allTags(row);
      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;
      return true;
    });

    // Score and explain
    const scored = candidates.map((row: BuyerRow) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classifyScore(detail.total); // 'cold' | 'warm' | 'hot'
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxWarm);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxHot);

    const items: LeadItem[] = [...hot, ...warm].map((s) => {
      const r = s.row as any;
      const title: string = r.name || r.title || r.host || "Potential buyer";
      return {
        host: String(r.host || "").toLowerCase(),
        platform: "web",
        title,
        created: nowIso(),
        temp: s.klass as Temp,
        score: Number(s.score || 0),
        why: s.why,
      };
    });

    return res.json({ items });
  } catch (err: unknown) {
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String((err as { message?: string })?.message ?? err),
    });
  }
});

// keep both exports so index.ts can import default or named
export default LeadsRouter;