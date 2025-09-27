// src/routes/leads.ts
//
// Hardened against catalog shape drift.
// - Accepts BuyerRow[] | {rows} | {items}
// - No mutation of rows (keeps shared types happy)
// - Explicit types to satisfy noImplicitAny
// - Provides both named and default export for index.ts compatibility

import { Router, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags } from "../shared/trc";

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

// NOTE: this path is relative to the mount in index.ts (`/api/leads`)
LeadsRouter.get("/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "";
    const city = q(req, "city");
    const radiusQ = q(req, "radiusKm");
    const radius = radiusQ != null ? Number(radiusQ) : NaN;

    // optional overall limit (panel "Limit" box)
    const limitQ = q(req, "limit");
    const hardLimit = Number.isFinite(Number(limitQ)) ? Math.max(1, Math.min(200, Number(limitQ))) : undefined;

    let prefs = getPrefs(supplierHost);
    if (city || Number.isFinite(radius)) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    const candidates: BuyerRow[] = rows.filter((row: BuyerRow) => {
      const tags = allTags(row);
      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;
      return true;
    });

    const scored = candidates.map((row: BuyerRow) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classifyScore(detail.total); // 'cold' | 'warm' | 'hot'
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score);

    // Respect prefs caps first, then optional hardLimit from query
    const capped = [...hot.slice(0, prefs.maxHot), ...warm.slice(0, prefs.maxWarm)];
    const finalList = typeof hardLimit === "number" ? capped.slice(0, hardLimit) : capped;

    const items: LeadItem[] = finalList.map((s) => {
      const r = s.row as any;
      const title: string = r.name || r.title || r.host || "Potential buyer";
      return {
        host: String(r.host || "").toLowerCase(),
        platform: "web",
        title,
        created: nowIso(),
        temp: (s.klass === "hot" ? "hot" : "warm") as Temp,
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