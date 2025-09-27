// src/routes/leads.ts
//
// Hardened against catalog shape drift.
// - Accepts BuyerRow[] | {rows} | {items}
// - No mutation of rows (keeps shared types happy)
// - Explicit types to satisfy noImplicitAny
// - Provides both named and default export for index.ts compatibility
// - PATCH: respects ?minTier= (A|B|C), ?limit=, and global ALLOW_TIERS guardrail.

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

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "";
    const city = q(req, "city");

    // honor ?limit= with guardrail cap (treat as free-plan for now)
    const limitWant = Number(q(req, "limit"));
    const outCap = capResults(false /* isPro */, Number.isFinite(limitWant) ? limitWant : 12);

    // honor ?minTier= (A|B|C) — override tier focus for this supplier
    const minTierQ = (q(req, "minTier") || "").toUpperCase().replace(/[^ABC]/g, "");
    const minTier: Tier | undefined =
      minTierQ === "A" || minTierQ === "B" || minTierQ === "C" ? (minTierQ as Tier) : undefined;

    let prefs = getPrefs(supplierHost);
    if (city || minTier) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        tierFocus: minTier ? [minTier] : prefs.tierFocus,
      });
    }

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    const candidates: BuyerRow[] = rows.filter((row: BuyerRow) => {
      const tags = allTags(row);
      const rowTiers = (row as any).tiers as string[] | undefined;

      // Global env guardrail (e.g. ALLOW_TIERS=AB)
      if (!allowedByEnv(rowTiers)) return false;

      // Per-request prefs
      if (!tierPass(prefs, rowTiers)) return false;
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

    // Sort by score descending within each band
    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score);

    // Prioritize HOT, then WARM, capped by ?limit (with env guardrail)
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