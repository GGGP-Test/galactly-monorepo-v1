// src/routes/leads.ts
//
// Leads routes:
// - GET    /api/leads/find-buyers
// - POST   /api/leads/lock
// - GET    /api/leads/locked
// - DELETE /api/leads/lock
//
// Additions in this “full” version:
// • Skips already locked buyers in /find-buyers.
// • Progressive relaxation to ensure useful results (< 1 min UX goal).
// • Optional per-call knobs: ?min=, ?wantHot=, ?wantWarm=, ?allowLarge=, ?relax=0..5
// • Keeps API stable; lock store still in-memory for now.

import { Router, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags, estimateSize, isLocalToCity } from "../shared/trc";

export const LeadsRouter = Router();

// ------------ small utils ------------
function q(req: Request, key: string): string | undefined {
  const v = (req.query as any)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}
function qNum(req: Request, key: string, def: number): number {
  const s = q(req, key);
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}
function qBool(req: Request, key: string, def: boolean): boolean {
  const s = q(req, key);
  if (s == null) return def;
  const v = s.toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return def;
}
function nowIso(): string {
  return new Date().toISOString();
}
function normalizeHost(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}
function toArrayMaybe(cat: unknown): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
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

// ------------ types ------------
type Temp = "warm" | "hot";
export interface LeadItem {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: Temp;
  score: number;
  why: string;
}

// ------------ in-memory locks ------------
/** LOCKS maps supplierHost -> Map<buyerHost, LeadItem> */
const LOCKS: Map<string, Map<string, LeadItem>> = new Map();
function getLockBucket(supplierHost: string): Map<string, LeadItem> {
  const key = normalizeHost(supplierHost);
  let bucket = LOCKS.get(key);
  if (!bucket) {
    bucket = new Map<string, LeadItem>();
    LOCKS.set(key, bucket);
  }
  return bucket;
}

// ------------ candidate pipeline ------------
interface RelaxPlan {
  // step semantics, increasing relaxation
  step: number;
  widenTiers: boolean;      // include all tiers regardless of prefs
  ignoreAllow: boolean;     // ignore categoriesAllow filter
  ignoreBlock: boolean;     // ignore categoriesBlock filter
  ignoreLocality: boolean;  // stop requiring/boosting city alignment
  allowLarge: boolean;      // permit large even if preferSmallMid
}
function planFor(step: number, forceAllowLarge?: boolean): RelaxPlan {
  const s = Math.max(0, Math.min(5, step));
  const p: RelaxPlan = {
    step: s,
    widenTiers: s >= 1,
    ignoreAllow: s >= 2,
    ignoreBlock: s >= 3,
    ignoreLocality: s >= 4,
    allowLarge: (forceAllowLarge === true) || s >= 5,
  };
  return p;
}

function tierPass(prefs: EffectivePrefs, rowTiers?: ReadonlyArray<string>, relax: RelaxPlan): boolean {
  if (relax.widenTiers) return true;
  if (!prefs.tierFocus?.length) return true;
  if (!rowTiers?.length) return true;
  const want = new Set<string>(prefs.tierFocus.map(String));
  for (const t of rowTiers) if (want.has(String(t))) return true;
  return false;
}

function filterRows(
  rows: BuyerRow[],
  supplierHost: string,
  prefs: EffectivePrefs,
  relax: RelaxPlan,
  lockedForSupplier: Set<string>
): BuyerRow[] {
  const sup = normalizeHost(supplierHost);
  return rows.filter((row) => {
    const rhost = normalizeHost((row as any).host || "");
    if (!rhost) return false;

    // Exclude supplier’s own domain
    if (sup && rhost === sup) return false;

    // Exclude already locked buyers for this supplier
    if (lockedForSupplier.has(rhost)) return false;

    // Tier and tag filters
    const tags = allTags(row);
    const rowTiers = (row as any).tiers as string[] | undefined;

    if (!tierPass(prefs, rowTiers, relax)) return false;
    if (!relax.ignoreBlock && hasBlockedTags(prefs, tags)) return false;
    if (!relax.ignoreAllow && !passesAllowTags(prefs, tags)) return false;

    // Optional: if preferSmallMid and not allowed to include large, drop large estimates
    if (prefs.preferSmallMid && !relax.allowLarge) {
      const size = estimateSize(row);
      if (size === "large") return false;
    }

    // Locality “hard” gate only when not ignoring locality:
    if (!relax.ignoreLocality && prefs.city) {
      // We don’t *require* exact locality; we boost it in scoring,
      // but as a gentle filter, allow through both locals and non-locals.
      // (So we do NOT reject non-local here.)
      // Keep this comment to clarify: no hard reject on locality.
    }

    return true;
  });
}

function scoreAndSelect(
  candidates: BuyerRow[],
  prefs: EffectivePrefs,
  relax: RelaxPlan
): { hot: LeadItem[]; warm: LeadItem[] } {
  const scored = candidates.map((row) => {
    const detail = scoreRow(row as any, prefs);
    const klass = classifyScore(detail.total);
    const metaRelax = relax.step > 0 ? `relax=${relax.step}` : undefined;

    const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
    if (metaRelax) whyBits.push(metaRelax);

    const r = row as any;
    const title: string = r.name || r.title || r.host || "Potential buyer";

    const item: LeadItem = {
      host: normalizeHost(String(r.host || "")),
      platform: "web",
      title,
      created: nowIso(),
      temp: (klass === "hot" ? "hot" : "warm"),
      score: Number(detail.total || 0),
      why: buildWhy({ ...detail, reasons: whyBits }),
    };
    return { item, klass, score: detail.total };
  });

  const hot = scored.filter(s => s.klass === "hot").sort((a, b) => b.score - a.score).map(s => s.item);
  const warm = scored.filter(s => s.klass === "warm").sort((a, b) => b.score - a.score).map(s => s.item);
  return { hot, warm };
}

// ------------ routes ------------
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = normalizeHost(
      q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || ""
    );
    const city = q(req, "city");
    const radius = qNum(req, "radiusKm", 50);

    // Optional per-call knobs with safe defaults
    const wantHot = Math.max(0, Math.min(5, qNum(req, "wantHot", NaN)));
    const wantWarm = Math.max(0, Math.min(50, qNum(req, "wantWarm", NaN)));
    const minTotal = Math.max(0, Math.min(50, qNum(req, "min", 1))); // minimum total items desired
    const forceAllowLarge = qBool(req, "allowLarge", false);
    const startRelax = Math.max(0, Math.min(5, qNum(req, "relax", 0)));

    let prefs = getPrefs(supplierHost || "example.com");
    // Update city/radius if provided
    if (city || Number.isFinite(radius)) {
      prefs = setPrefs(supplierHost || "example.com", {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    // Respect per-call budgets if provided, otherwise fall back to prefs
    const maxHot = Number.isFinite(wantHot) ? wantHot : prefs.maxHot;
    const maxWarm = Number.isFinite(wantWarm) ? wantWarm : prefs.maxWarm;

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    const lockedBucket = getLockBucket(supplierHost || "example.com");
    const lockedSet = new Set<string>(Array.from(lockedBucket.keys()));

    let collected: LeadItem[] = [];
    let usedRelaxStep = startRelax;

    for (let step = startRelax; step <= 5; step++) {
      const relax = planFor(step, forceAllowLarge);
      const filtered = filterRows(rows, supplierHost, prefs, relax, lockedSet);
      const { hot, warm } = scoreAndSelect(filtered, prefs, relax);

      const picked: LeadItem[] = [
        ...hot.slice(0, maxHot),
        ...warm.slice(0, Math.max(0, minTotal - Math.min(hot.length, maxHot))), // top-up with warm if needed
        ...warm.slice(0, maxWarm), // plus normal warm budget
      ];

      // De-dup picked by host (in case of overlap)
      const seen = new Set<string>();
      collected = picked.filter((it) => {
        if (seen.has(it.host)) return false;
        seen.add(it.host);
        return true;
      });

      if (collected.length >= minTotal) {
        usedRelaxStep = step;
        break;
      }
      // else continue to next relaxation step
    }

    // Final trim to budgets
    const hotOut: LeadItem[] = [];
    const warmOut: LeadItem[] = [];
    for (const it of collected) {
      if (it.temp === "hot" && hotOut.length < maxHot) hotOut.push(it);
      else if (warmOut.length < maxWarm) warmOut.push(it);
    }

    const items = [...hotOut, ...warmOut];

    return res.json({
      items,
      meta: {
        supplierHost,
        city: prefs.city,
        prefsSummary: prefsSummary(prefs),
        usedRelaxStep,
        lockedCount: lockedSet.size,
        budgets: { hot: maxHot, warm: maxWarm, min: minTotal },
      },
    });
  } catch (err: any) {
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String(err?.message || err),
    });
  }
});

// ---- Lock a candidate ----
// body: { supplierHost: string, host: string, title: string, temp?: "warm"|"hot", score?: number, why?: string }
LeadsRouter.post("/api/leads/lock", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const supplierHost = normalizeHost(String(body.supplierHost || body.host || ""));
    const buyerHost = normalizeHost(String(body.buyerHost || body.host || ""));
    const title = String(body.title || "").trim();

    if (!supplierHost || !buyerHost || !title) {
      return res.status(400).json({ ok: false, error: "host-and-title-required" });
    }
    if (supplierHost === buyerHost) {
      return res.status(400).json({ ok: false, error: "cannot-lock-self" });
    }

    const item: LeadItem = {
      host: buyerHost,
      platform: "web",
      title,
      created: nowIso(),
      temp: (body.temp === "hot" ? "hot" : "warm"),
      score: Number(body.score || 0),
      why: String(body.why || "locked by user"),
    };

    const bucket = getLockBucket(supplierHost);
    bucket.set(buyerHost, item);

    return res.json({ ok: true, locked: item, total: bucket.size });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "lock-failed", detail: String(err?.message || err) });
  }
});

// ---- List locks for a supplier ----
// GET /api/leads/locked?host=SUPPLIER_HOST
LeadsRouter.get("/api/leads/locked", (req: Request, res: Response) => {
  try {
    const supplierHost = normalizeHost(q(req, "host") || q(req, "supplierHost") || "");
    if (!supplierHost) return res.status(400).json({ ok: false, error: "Missing ?host" });
    const bucket = getLockBucket(supplierHost);
    const items = Array.from(bucket.values());
    return res.json({ ok: true, items, total: items.length });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "locked-list-failed", detail: String(err?.message || err) });
  }
});

// ---- Unlock one or all ----
// DELETE /api/leads/lock?host=SUPPLIER_HOST&buyer=BUYER_HOST   -> removes one
// DELETE /api/leads/lock?host=SUPPLIER_HOST&all=1              -> clears all
LeadsRouter.delete("/api/leads/lock", (req: Request, res: Response) => {
  try {
    const supplierHost = normalizeHost(q(req, "host") || q(req, "supplierHost") || "");
    if (!supplierHost) return res.status(400).json({ ok: false, error: "Missing ?host" });

    const buyer = normalizeHost(q(req, "buyer") || "");
    const all = q(req, "all");

    const bucket = getLockBucket(supplierHost);

    if (all) {
      bucket.clear();
      return res.json({ ok: true, cleared: true, total: 0 });
    }

    if (!buyer) return res.status(400).json({ ok: false, error: "Missing ?buyer or use &all=1" });

    const existed = bucket.delete(buyer);
    return res.json({ ok: true, removed: existed, total: bucket.size });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "unlock-failed", detail: String(err?.message || err) });
  }
});

// keep both exports so index.ts can import default or named
export default LeadsRouter;