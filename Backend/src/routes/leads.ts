// src/routes/leads.ts
//
// Leads routes:
// - GET    /api/leads/find-buyers   -> rank candidates from catalog
// - POST   /api/leads/lock          -> lock one candidate for a supplier
// - GET    /api/leads/locked        -> list locked candidates for a supplier
// - DELETE /api/leads/lock          -> unlock one (by buyer host) or all
//
// Notes:
// • Defensive against catalog shape drift (array | {rows} | {items}).
// • Excludes the supplier’s own domain from candidates.
// • Lock storage is in-memory (swap to DB later without changing route contract).
// • Exposes both a Router (default) and named export for index.ts flexibility.

import { Router, Request, Response } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags } from "../shared/trc";

export const LeadsRouter = Router();

// ------------ small utils ------------
function q(req: Request, key: string): string | undefined {
  const v = (req.query as any)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
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

function tierPass(prefs: EffectivePrefs, rowTiers?: ReadonlyArray<string>): boolean {
  if (!prefs.tierFocus?.length) return true;
  if (!rowTiers?.length) return true;
  const want = new Set<string>(prefs.tierFocus.map(String));
  for (const t of rowTiers) if (want.has(String(t))) return true;
  return false;
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
/**
 * LOCKS maps supplierHost -> Map<buyerHost, LeadItem>
 * Replace with Neon later; route contract can stay the same.
 */
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

// ------------ routes ------------
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = normalizeHost(
      q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || ""
    );
    const city = q(req, "city");
    const radius = Number(q(req, "radiusKm") || 50);

    let prefs = getPrefs(supplierHost || "example.com");
    if (city || Number.isFinite(radius)) {
      prefs = setPrefs(supplierHost || "example.com", {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    // Filter pipeline
    const candidates: BuyerRow[] = rows.filter((row: BuyerRow) => {
      const rhost = normalizeHost((row as any).host || "");
      if (!rhost) return false;

      // Exclude the supplier’s own domain
      if (supplierHost && rhost === supplierHost) return false;

      const tags = allTags(row);
      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;

      return true;
    });

    // Score + classify
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
        host: normalizeHost(String(r.host || "")),
        platform: "web",
        title,
        created: nowIso(),
        temp: s.klass as Temp,
        score: Number(s.score || 0),
        why: s.why,
      };
    });

    return res.json({ items });
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