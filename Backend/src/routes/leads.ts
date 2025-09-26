// src/routes/leads.ts
//
// Leads endpoint with:
//  - Env-tunable warm/hot thresholds
//  - In-memory lock/locked/unlock so the Free Panel "Lock" works
//  - Safe against catalog shape drift (array | {rows} | {items})
//  - No external deps; exports both named and default Router

import { Router, Request, Response, json } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, buildWhy, allTags } from "../shared/trc";

// ---------- router ----------
export const LeadsRouter = Router();
LeadsRouter.use(json()); // ensure POST bodies parse even if index didn't add global json()

// ---------- env knobs (safe defaults) ----------
function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
const HOT_CUTOFF  = num(process.env.HOT_CUTOFF, 1.8);
const WARM_CUTOFF = num(process.env.WARM_CUTOFF, 0.9);
const MAX_WARM_CAP = num(process.env.MAX_WARM_CAP, 8);
const MAX_HOT_CAP  = num(process.env(MAX_HOT_CAP as any), 3); // tolerate undefined; we clamp again below

function classify(total: number): "cold" | "warm" | "hot" {
  if (total >= HOT_CUTOFF) return "hot";
  if (total >= WARM_CUTOFF) return "warm";
  return "cold";
}

// ---------- small helpers ----------
function q(req: Request, key: string): string | undefined {
  const v = (req.query as any)?.[key];
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
function tierPass(prefs: EffectivePrefs, rowTiers?: ReadonlyArray<string>): boolean {
  if (!prefs.tierFocus?.length) return true;
  if (!rowTiers?.length) return true;
  const want = new Set<string>(prefs.tierFocus.map(String));
  for (const t of rowTiers) if (want.has(String(t))) return true;
  return false;
}
function toArrayMaybe(cat: unknown): BuyerRow[] {
  const anyCat = cat as any;
  if (Array.isArray(anyCat)) return anyCat as BuyerRow[];
  if (Array.isArray(anyCat?.rows)) return anyCat.rows as BuyerRow[];
  if (Array.isArray(anyCat?.items)) return anyCat.items as BuyerRow[];
  return [];
}

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

// ---------- in-memory locks (no DB yet) ----------
const LOCKS = new Map<string, Map<string, LeadItem>>(); // supplierHost -> (leadHost -> item)

function getLockBucket(supplierHost: string): Map<string, LeadItem> {
  const key = supplierHost.toLowerCase();
  let bucket = LOCKS.get(key);
  if (!bucket) {
    bucket = new Map<string, LeadItem>();
    LOCKS.set(key, bucket);
  }
  return bucket;
}

// ---------- find-buyers ----------
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = (q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "").toLowerCase();
    const city = q(req, "city");
    const radius = Number(q(req, "radiusKm") || 50);

    if (!supplierHost) {
      return res.status(400).json({ items: [], error: "missing-supplier-host" });
    }

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
      // allow/block lists
      if (prefs.categoriesBlock.length && intersects(prefs.categoriesBlock, tags)) return false;
      if (prefs.categoriesAllow.length && !intersects(prefs.categoriesAllow, tags)) return false;
      // tier
      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      return true;
    });

    const scored = candidates.map((row: BuyerRow) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classify(detail.total);
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    const maxWarm = Math.max(0, Math.min(MAX_WARM_CAP, prefs.maxWarm));
    const maxHot  = Math.max(0, Math.min(MAX_HOT_CAP,  prefs.maxHot));

    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score)
      .slice(0, maxWarm);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score)
      .slice(0, maxHot);

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

    return res.json({ items, prefs: { summary: prefsSummary(prefs) } });
  } catch (err: any) {
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String(err?.message || err),
    });
  }
});

// ---------- locks API (no DB, flexible params) ----------

// POST /api/leads/lock
// body OR query may contain:
//   supplierHost|supplier|host   -> supplier's domain (required)
//   leadHost|buyer|candidate     -> buyer domain (required)
//   title                        -> optional title
//   score, temp, why             -> optional; we’ll fill defaults
LeadsRouter.post("/api/leads/lock", (req: Request, res: Response) => {
  try {
    const B = (req.body || {}) as Partial<LeadItem> & Record<string, any>;

    const supplier =
      (q(req, "supplierHost") || q(req, "supplier") || q(req, "host") || B.supplierHost || B.supplier || B.host || "")
        .toLowerCase()
        .trim();

    const leadHost =
      (q(req, "leadHost") || q(req, "buyer") || q(req, "candidate") || B.leadHost || B.buyer || B.candidate || B.host || "")
        .toLowerCase()
        .trim();

    const title = String(B.title || q(req, "title") || "Potential buyer").trim();

    if (!supplier || !leadHost) {
      return res.status(400).json({ ok: false, error: "supplierHost and leadHost required" });
    }

    const item: LeadItem = {
      host: leadHost,
      platform: "web",
      title,
      created: nowIso(),
      temp: (B.temp as Temp) || "warm",
      score: Number.isFinite(B.score) ? Number(B.score) : 0,
      why: String(B.why || "locked manually"),
    };

    const bucket = getLockBucket(supplier);
    bucket.set(leadHost, item);

    return res.json({ ok: true, locked: item, total: bucket.size });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "lock-failed", detail: String(err?.message || err) });
  }
});

// GET /api/leads/locked?host=supplierHost
LeadsRouter.get("/api/leads/locked", (req: Request, res: Response) => {
  const supplier = (q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "").toLowerCase().trim();
  if (!supplier) return res.status(400).json({ ok: false, error: "missing-supplier-host" });
  const bucket = getLockBucket(supplier);
  return res.json({ ok: true, items: Array.from(bucket.values()), total: bucket.size });
});

// DELETE /api/leads/locked?host=supplierHost&leadHost=buyer.com
LeadsRouter.delete("/api/leads/locked", (req: Request, res: Response) => {
  const supplier = (q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "").toLowerCase().trim();
  const leadHost = (q(req, "leadHost") || q(req, "buyer") || q(req, "candidate") || "").toLowerCase().trim();
  if (!supplier || !leadHost) return res.status(400).json({ ok: false, error: "supplierHost and leadHost required" });

  const bucket = getLockBucket(supplier);
  const existed = bucket.delete(leadHost);
  return res.json({ ok: true, removed: existed, total: bucket.size });
});

// Optional: clear all locks for a supplier (not wired in UI)
// POST /api/leads/locked/clear  body: { host: "supplier.com" }
LeadsRouter.post("/api/leads/locked/clear", (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, any>;
  const supplier = String(body.host || body.supplier || body.supplierHost || "").toLowerCase().trim();
  if (!supplier) return res.status(400).json({ ok: false, error: "missing-supplier-host" });
  LOCKS.set(supplier, new Map());
  return res.json({ ok: true, total: 0 });
});

// keep default export for index.ts
export default LeadsRouter;