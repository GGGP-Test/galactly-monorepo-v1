// src/routes/leads.ts
//
// Hardened, city-aware buyer finding + lightweight locking.
// - Keeps your scoring & prefs flow intact.
// - Adds in-memory per-supplier locks with TTL, no DB required.
// - One-file change; no new dependencies.

import { Router, Request, Response, json } from "express";
import { loadCatalog, type BuyerRow } from "../shared/catalog";
import { getPrefs, setPrefs, prefsSummary, type EffectivePrefs } from "../shared/prefs";
import { scoreRow, classifyScore, buildWhy, allTags } from "../shared/trc";

export const LeadsRouter = Router();
LeadsRouter.use(json()); // allow POST JSON bodies to /lock, /unlock

/** safe query getter */
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
  locked?: boolean;
}

/* ---------------------------
   In-memory locks with TTL
---------------------------- */

interface LockRec {
  supplier: string;   // normalized supplier host
  host: string;       // buyer host
  title?: string;     // optional title for fallback display
  at: number;         // ms timestamp
  ttlMs: number;      // time to live in ms
}

const LOCKS = new Map<string, LockRec>(); // key: `${supplier}|${host}`

function normHost(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function lockTtlMs(): number {
  const sec = Number(process.env.LOCK_TTL_SEC ?? 900);
  const sane = Number.isFinite(sec) ? Math.max(60, Math.min(86400, sec)) : 900; // 1 min..24h
  return sane * 1000;
}

function lockKey(supplierHost: string, buyerHost: string): string {
  return `${normHost(supplierHost)}|${normHost(buyerHost)}`;
}

function purgeExpired() {
  const now = Date.now();
  for (const [k, rec] of LOCKS) {
    if (now - rec.at > rec.ttlMs) LOCKS.delete(k);
  }
}

function isLocked(supplierHost: string, buyerHost: string): boolean {
  purgeExpired();
  return LOCKS.has(lockKey(supplierHost, buyerHost));
}

function getSupplierLockedHosts(supplierHost: string): LockRec[] {
  purgeExpired();
  const sup = normHost(supplierHost);
  const out: LockRec[] = [];
  for (const rec of LOCKS.values()) {
    if (rec.supplier === sup) out.push(rec);
  }
  return out;
}

/* ---------------------------
   Routes
---------------------------- */

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const supplierHost = normHost(q(req, "host") || q(req, "supplier") || q(req, "supplierHost") || "");
    const city = q(req, "city");
    const radius = Number(q(req, "radiusKm") || 50);

    let prefs = getPrefs(supplierHost);
    if (city || Number.isFinite(radius)) {
      prefs = setPrefs(supplierHost, {
        city: city ?? prefs.city,
        radiusKm: Number.isFinite(radius) ? radius : prefs.radiusKm,
      });
    }

    const catalog = await loadCatalog();
    const rows: BuyerRow[] = toArrayMaybe(catalog);

    // Base candidate filter (tier + allow/block tags)
    const candidates: BuyerRow[] = rows.filter((row: BuyerRow) => {
      const tags = allTags(row);
      if (!tierPass(prefs, (row as any).tiers as string[] | undefined)) return false;
      if (hasBlockedTags(prefs, tags)) return false;
      if (!passesAllowTags(prefs, tags)) return false;
      return true;
    });

    // Score & classify
    const scored = candidates.map((row: BuyerRow) => {
      const detail = scoreRow(row as any, prefs);
      const klass = classifyScore(detail.total); // 'cold' | 'warm' | 'hot'
      const whyBits = [`prefs: ${prefsSummary(prefs)}`, ...detail.reasons];
      const why = buildWhy({ ...detail, reasons: whyBits });
      return { row, score: detail.total, klass, why };
    });

    // Prepare warm/hot picks
    const warm = scored
      .filter((s) => s.klass === "warm")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxWarm);

    const hot = scored
      .filter((s) => s.klass === "hot")
      .sort((a, b) => b.score - a.score)
      .slice(0, prefs.maxHot);

    // Build items
    const picked = [...hot, ...warm];

    // Promote existing locks for this supplier (ensure they’re present & marked)
    const locked = getSupplierLockedHosts(supplierHost);
    const byHost = new Map<string, LeadItem>();

    // First, add scored picks
    for (const s of picked) {
      const r = s.row as any;
      const title: string = r.name || r.title || r.host || "Potential buyer";
      byHost.set(String(r.host).toLowerCase(), {
        host: String(r.host || "").toLowerCase(),
        platform: "web",
        title,
        created: nowIso(),
        temp: s.klass as Temp,
        score: Number(s.score || 0),
        why: s.why,
        locked: isLocked(supplierHost, r.host),
      });
    }

    // Then, ensure any locked-but-not-picked are included at top with minimal info
    for (const L of locked) {
      const h = L.host.toLowerCase();
      if (!byHost.has(h)) {
        byHost.set(h, {
          host: h,
          platform: "web",
          title: L.title || h,
          created: nowIso(),
          temp: "warm",
          score: 999, // float to the top visually
          why: "locked • previously saved by you",
          locked: true,
        });
      } else {
        // mark as locked
        const item = byHost.get(h)!;
        item.locked = true;
        // small bump to keep locked near top
        item.score = Math.max(item.score, 999);
      }
    }

    // Final list (locked first by score=999, then remaining by score)
    const items: LeadItem[] = Array.from(byHost.values())
      .sort((a, b) => b.score - a.score)
      .map((it) => ({ ...it, score: Number.isFinite(it.score) ? it.score : 0 }));

    return res.json({ items });
  } catch (err: any) {
    return res.status(200).json({
      items: [],
      error: "find-buyers-failed",
      detail: String(err?.message || err),
    });
  }
});

/**
 * POST /api/leads/lock
 * body: { supplierHost: string, host: string, title?: string }
 */
LeadsRouter.post("/api/leads/lock", (req: Request, res: Response) => {
  try {
    const supplierHost = normHost(String(req.body?.supplierHost || req.body?.supplier || req.body?.host || ""));
    const buyerHost = normHost(String(req.body?.buyerHost || req.body?.leadHost || req.body?.host || ""));
    const title = String(req.body?.title || "").trim() || undefined;

    if (!supplierHost || !buyerHost) {
      return res.status(400).json({ ok: false, error: "supplierHost and host required" });
    }

    const rec: LockRec = {
      supplier: supplierHost,
      host: buyerHost,
      title,
      at: Date.now(),
      ttlMs: lockTtlMs(),
    };
    LOCKS.set(lockKey(supplierHost, buyerHost), rec);
    purgeExpired();

    return res.json({ ok: true, locked: { host: rec.host, title: rec.title, until: new Date(rec.at + rec.ttlMs).toISOString() } });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "lock-failed", detail: String(err?.message || err) });
  }
});

/**
 * POST /api/leads/unlock
 * body: { supplierHost: string, host: string }
 */
LeadsRouter.post("/api/leads/unlock", (req: Request, res: Response) => {
  try {
    const supplierHost = normHost(String(req.body?.supplierHost || req.body?.supplier || ""));
    const buyerHost = normHost(String(req.body?.buyerHost || req.body?.host || ""));
    if (!supplierHost || !buyerHost) {
      return res.status(400).json({ ok: false, error: "supplierHost and host required" });
    }
    LOCKS.delete(lockKey(supplierHost, buyerHost));
    purgeExpired();
    return res.json({ ok: true, unlocked: buyerHost });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "unlock-failed", detail: String(err?.message || err) });
  }
});

/**
 * GET /api/leads/locks?supplierHost=example.com
 * (debug/UX support)
 */
LeadsRouter.get("/api/leads/locks", (req: Request, res: Response) => {
  try {
    const supplierHost = normHost(String(req.query?.supplierHost || req.query?.supplier || req.query?.host || ""));
    if (!supplierHost) return res.status(400).json({ ok: false, error: "Missing ?supplierHost" });
    const rows = getSupplierLockedHosts(supplierHost).map((r) => ({
      host: r.host,
      title: r.title,
      expiresAt: new Date(r.at + r.ttlMs).toISOString(),
    }));
    return res.json({ ok: true, items: rows });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: "locks-failed", detail: String(err?.message || err) });
  }
});

// keep default export so index.ts can `import leads from "./routes/leads"`
export default LeadsRouter;