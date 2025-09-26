// src/routes/leads.ts
//
// Finds buyer leads and classifies them as warm/hot using Tier-C heuristics.
// Keeps everything conservative to stay green:
//  - does NOT mutate catalog rows (no row.why etc.)
//  - uses only exports that already exist
//  - returns the same response shape your panel expects: { items: [...] }

import { Router, Request, Response } from "express";

import { loadCatalog } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags, isLocalToCity } from "../shared/trc";

export const LeadsRouter = Router();

// -----------------------------
// Small helpers (no side effects)
// -----------------------------

function q(req: Request, key: string): string | undefined {
  const v = (req.query as any)?.[key];
  if (v == null) return undefined;
  return String(v).trim() || undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function intersects(a: string[] = [], b: string[] = []): boolean {
  if (!a.length || !b.length) return false;
  const set = new Set(a.map((x) => x.toLowerCase()));
  return b.some((x) => set.has(String(x).toLowerCase()));
}

function hasBlockedTags(prefs: EffectivePrefs, tags: string[]): boolean {
  if (!prefs.categoriesBlock.length) return false;
  return intersects(prefs.categoriesBlock, tags);
}

function passesAllowTags(prefs: EffectivePrefs, tags: string[]): boolean {
  if (!prefs.categoriesAllow.length) return true; // no allow-list means pass
  return intersects(prefs.categoriesAllow, tags);
}

// Simple tier gate that is type-lenient (avoids union type headaches)
function tierPass(prefs: EffectivePrefs, rowTiers?: ReadonlyArray<string>): boolean {
  if (!prefs.tierFocus?.length) return true;
  if (!rowTiers?.length) return true;
  const want = new Set<string>(prefs.tierFocus.map(String));
  for (const t of rowTiers) {
    if (want.has(String(t))) return true;
  }
  return false;
}

// -----------------------------
// Response item shape
// -----------------------------

type Temp = "warm" | "hot";

interface LeadItem {
  host: string;
  platform: "web";
  title: string;       // human label
  created: string;     // ISO
  temp: Temp;
  score: number;       // continuous score used for sorting
  why: string;         // readable reason string
}

// -----------------------------
// Route
// -----------------------------

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    // Inputs
    const supplierHost = q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "";
    const city = q(req, "city");              // optional city bias (panel may add this later)
    const radius = Number(q(req, "radiusKm") || 50); // kept for future; unused in this stateless pass

    // Resolve / update prefs (non-destructive defaults)
    let prefs = getPrefs(supplierHost);
    if (city || radius) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    // Catalog
    const rows = await loadCatalog(); // BuyerRow[]

    // PRE-FILTER: tiers + tag allow/block + light locality bias
    const candidates = rows.filter((row) => {
      // tags union (segments + tags)
      const tags = allTags(row);

      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;

      // If user provided a city, keep both locals and non-locals; scoring will boost locals.
      // We don't drop non-locals here to keep enough recall.
      return true;
    });

    // SCORE → classify
    type Scored = { row: any; score: number; klass: "cold" | "warm" | "hot"; why: string };
    const scored: Scored[] = candidates.map((row) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classifyScore(detail.total);
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    // Partition & sort
    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxWarm);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxHot);

    // Compose response items (hot first, then warm)
    const items: LeadItem[] = [...hot, ...warm].map((s) => {
      const r: any = s.row;
      const title =
        r.name ||
        r.title ||
        r.host ||
        "Potential buyer";

      return {
        host: String(r.host || "").toLowerCase(),
        platform: "web",
        title,
        created: nowIso(),
        temp: s.klass as Temp, // "hot" or "warm"
        score: Number(s.score || 0),
        why: s.why,
      };
    });

    return res.json({ items });
  } catch (err: any) {
    // Fail safe: never 500-loop the panel; surface detail in message
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String(err?.message || err),
    });
  }
});