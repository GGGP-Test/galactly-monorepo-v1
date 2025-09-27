// src/routes/leads.ts
//
// Finds buyers from the local catalog, scored by TRC, with guardrails.
// PATCH: if no items, include a lightweight fallback *hint* to Places search
//        so the UI can optionally fetch raw Tier-C candidates.
//        (We only return a URL hint; we do NOT auto-call Places here, so
//         existing cost/rate guards in /api/places/search remain the source of truth.)

import { Router, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import {
  getPrefs,
  setPrefs,
  prefsSummary,
  type EffectivePrefs,
  type Tier,
} from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags } from "../shared/trc";
import { CFG, capResults } from "../shared/env";

export const LeadsRouter = Router();

// ---------- tiny helpers ----------
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
/** Global allow-list from env (e.g. ALLOW_TIERS=AB) */
function allowedByEnv(rowTiers?: ReadonlyArray<string>): boolean {
  const allowed = CFG.allowTiers;
  if (!rowTiers?.length) return true;
  for (const t of rowTiers) {
    const up = String(t || "").toUpperCase() as "A" | "B" | "C";
    if (allowed.has(up)) return true;
  }
  return false;
}
/** Normalize loadCatalog() -> BuyerRow[] without depending on its TS type */
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

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost =
      q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "";
    const city = q(req, "city");

    // honor ?limit= with guardrail cap (treat as free-plan for now)
    const want = Number(q(req, "limit"));
    const outCap = capResults(false /* isPro */, Number.isFinite(want) ? want : 12);

    // honor ?minTier= (A|B|C) — override tier focus for this supplier
    const minTierQ = (q(req, "minTier") || "").toUpperCase().replace(/[^ABC]/g, "");
    const minTier: Tier | undefined =
      minTierQ === "A" || minTierQ === "B" || minTierQ === "C"
        ? (minTierQ as Tier)
        : undefined;

    let prefs = getPrefs(supplierHost);
    if (city || minTier) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        tierFocus: minTier ? [minTier] : prefs.tierFocus,
      });
    }

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    const candidates: BuyerRow[] = rows.filter((row) => {
      const tags = allTags(row);
      const rowTiers = (row as any).tiers as string[] | undefined;

      if (!allowedByEnv(rowTiers)) return false; // env guard (e.g., AB only)
      if (!tierPass(prefs, rowTiers)) return false; // per-request focus
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;
      return true;
    });

    const scored = candidates.map((row) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classifyScore(detail.total); // 'cold' | 'warm' | 'hot'
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    // Sort by score descending within each band
    const warm = scored.filter((s) => s.klass === "warm").sort((a, b) => b.score - a.score);
    const hot = scored.filter((s) => s.klass === "hot").sort((a, b) => b.score - a.score);

    // Prioritize HOT, then WARM, capped
    const pick = [...hot, ...warm].slice(0, outCap);

    const items: LeadItem[] = pick.map((s) => {
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

    // ---- PATCH: include a hint to Places if nothing was found
    // We keep the hint dumb and cheap; UI may choose to call that URL.
    let hint: undefined | { places: { url: string; q: string; city: string; limit: number } };
    if (items.length === 0 && CFG.googlePlacesApiKey) {
      // Tiny heuristic: Tier-C discovery in food/retail via coffee/bakery
      const qWords = ["coffee shop", "bakery"];
      const qText = qWords.join(" ");
      const c = (prefs.city || "").trim();
      const url =
        "/api/places/search?" +
        new URLSearchParams({
          q: qText,
          city: c,
          limit: String(outCap),
        }).toString();
      hint = { places: { url, q: qText, city: c, limit: outCap } };
    }

    return res.json(hint ? { items, hint } : { items });
  } catch (err: unknown) {
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String((err as { message?: string })?.message ?? err),
    });
  }
});

export default LeadsRouter;