// src/routes/leads.ts
import { Router } from "express";
import { findTierC } from "../shared/catalog";
import { setPrefs, getPrefs, prefsSummary, normalizeHost } from "../shared/prefs";

const router = Router();

// ===== Panel-facing types (stable with your panel) =====
type Temperature = "hot" | "warm";
type PanelItem = {
  id: number;
  host: string;          // buyer domain
  platform?: string;     // e.g. "web"
  title: string;         // buyer friendly name
  created: string;       // ISO
  temperature: Temperature;
  whyText?: string;      // short reason
  why?: any;             // object with signal/context
};

// ===== very small in-memory panel store =====
let nextId = 1;
const store: { hot: PanelItem[]; warm: PanelItem[] } = { hot: [], warm: [] };
function resetStore() { store.hot = []; store.warm = []; nextId = 1; }

// mount-time note to help diagnose
// eslint-disable-next-line no-console
console.log("[leads] routes mounted: /api/leads/...");

// ---------- helpers ----------
function nowISO() { return new Date().toISOString(); }

function toPanelItem(
  buyerHost: string,
  buyerName: string,
  temperature: Temperature,
  score: number,
  why: string,
  city?: string
): PanelItem {
  const title = buyerName || buyerHost;
  return {
    id: nextId++,
    host: buyerHost,
    platform: "web",
    title,
    created: nowISO(),
    temperature,
    whyText: `${title}${city ? " • " + city : ""} • score ${score.toFixed(2)}`,
    why: {
      signal: {
        label: temperature === "hot" ? "High match" : "Good match",
        score: Number(score.toFixed(2)),
        detail: why
      },
      context: {
        label: "Catalog (Tier-C)",
        detail: city ? `city=${city}` : undefined
      }
    }
  };
}

function classify(score: number, exactCity: boolean): Temperature {
  if (exactCity) return "hot";
  return score >= 2.2 ? "hot" : "warm";
}

// ---------- health & debug ----------
router.get("/ping", (_req, res) => res.json({ ok: true, ts: nowISO() }));

router.get("/", (req, res) => {
  const temp = String(req.query.temp || "warm").toLowerCase();
  const items = temp === "hot" ? store.hot : store.warm;
  res.json({ ok: true, items });
});

// ---------- POST /api/leads/find-buyers ----------
/**
 * Body (all optional except supplier):
 * {
 *   supplier: "peakpackaging.com",
 *   city?: "Los Angeles",
 *   tierFocus?: ("A"|"B"|"C")[],
 *   allow?: string[],   // category tags to prefer
 *   block?: string[],   // category tags to avoid
 *   maxWarm?: number,
 *   maxHot?: number
 * }
 */
router.post("/find-buyers", async (req, res) => {
  try {
    const body = (req.body || {}) as {
      supplier?: string;
      city?: string;
      tierFocus?: ("A"|"B"|"C")[];
      allow?: string[];
      block?: string[];
      maxWarm?: number;
      maxHot?: number;
    };

    const supplier = normalizeHost(String(body.supplier || ""));
    if (!supplier) {
      return res.status(400).json({ ok: false, error: "supplier (domain) is required" });
    }

    // Update prefs (stored in-memory; can persist later)
    const effective = setPrefs(supplier, {
      city: body.city,
      tierFocus: Array.isArray(body.tierFocus) && body.tierFocus.length ? body.tierFocus as any : undefined,
      categoriesAllow: Array.isArray(body.allow) ? body.allow : undefined,
      categoriesBlock: Array.isArray(body.block) ? body.block : undefined,
      maxWarm: typeof body.maxWarm === "number" ? body.maxWarm : undefined,
      maxHot: typeof body.maxHot === "number" ? body.maxHot : undefined,
    });

    // Pull scored Tier-C buyers from catalog, bias by city first.
    const limit = Math.max(3, Math.min(50, (effective.maxWarm || 5) + (effective.maxHot || 1) + 8));
    const scored = findTierC(effective, { limit, cityFirst: true });

    // Reset buckets for a clean panel refresh
    store.hot = [];
    store.warm = [];

    // Map to panel items with hot/warm split
    for (const s of scored) {
      const exactCity = !!(effective.city && s.buyer.city && effective.city.toLowerCase() === s.buyer.city.toLowerCase());
      const temp = classify(s.score, exactCity);
      const item = toPanelItem(s.buyer.host, s.buyer.name, temp, s.score, s.why, s.buyer.city);

      if (temp === "hot" && store.hot.length < (effective.maxHot || 1)) store.hot.push(item);
      else if (store.warm.length < (effective.maxWarm || 5)) store.warm.push(item);

      // stop if we’ve filled targets
      if (store.hot.length >= (effective.maxHot || 1) && store.warm.length >= (effective.maxWarm || 5)) break;
    }

    const nHot = store.hot.length;
    const nWarm = store.warm.length;

    return res.json({
      ok: true,
      supplier,
      prefs: {
        city: effective.city,
        tierFocus: effective.tierFocus,
        allow: effective.categoriesAllow,
        block: effective.categoriesBlock,
        summary: prefsSummary(effective),
      },
      created: nHot + nWarm,
      hot: nHot,
      warm: nWarm,
      items: [...store.hot, ...store.warm],
      message: `Created ${nHot + nWarm} candidate(s). Hot:${nHot} Warm:${nWarm}. Refresh lists to view.`
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[leads.find-buyers:error]", e?.stack || e?.message || String(e));
    return res.status(500).json({ ok: false, error: e?.message || "internal error" });
  }
});

// (optional) clear store for testing/panel
router.post("/__clear", (_req, res) => {
  resetStore();
  res.json({ ok: true });
});

export default router;