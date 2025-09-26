// src/routes/leads.ts
import { Router, Request, Response } from "express";
import { getPrefs, setPrefs, prefsSummary, EffectivePrefs, normalizeHost, Tier } from "../shared/prefs";
import { loadCatalog, type BuyerRow } from "../shared/catalog";

export type Temp = "warm" | "hot";

export interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO
  temp: Temp;
  why: string;
  score: number; // 0..100
}

const router = Router();

/** tiny helpers */
const nowISO = () => new Date().toISOString();
const asSet = <T extends string>(arr?: T[]) => new Set(arr || []);
const lc = (s?: string) => (s || "").toLowerCase().trim();

/** locality check (exact city match on cityTags) */
function isLocal(row: BuyerRow, city?: string): boolean {
  if (!city) return false;
  const want = lc(city);
  for (const c of row.cityTags || []) {
    if (lc(c) === want) return true;
  }
  return false;
}

/** tier match against user focus */
function matchTier(row: BuyerRow, focus: Tier[]): boolean {
  if (!row.tiers || row.tiers.length === 0) return true;
  const wanted = asSet<Tier>(focus as Tier[]);
  for (const t of row.tiers) {
    if (wanted.has(t)) return true;
  }
  return false;
}

/** category allow/block using tags+segments */
function categoryAllowed(row: BuyerRow, allow: string[], block: string[]): boolean {
  const tags = (row.tags || []).concat(row.segments || []).map(lc);
  if (block.length) {
    const ban = asSet(block.map(lc));
    for (const t of tags) if (ban.has(t)) return false;
  }
  if (allow.length) {
    const want = asSet(allow.map(lc));
    for (const t of tags) if (want.has(t)) return true;
    return false;
  }
  return true;
}

/** score + temperature */
function scoreRow(row: BuyerRow, p: EffectivePrefs, city?: string): { score: number; temp: Temp; whyBits: string[] } {
  let score = 50;
  const whyBits: string[] = [];

  // Tier bias
  if (matchTier(row, p.tierFocus)) {
    score += 8;
    whyBits.push(`tier∈[${p.tierFocus.join(",")}]`);
  } else {
    score -= 6;
  }

  // Size bias (defaults strongly favor micro/small/mid)
  const size = (row.size || "small") as keyof typeof p.sizeWeight;
  const sizeDelta = p.sizeWeight[size] || 0;
  score += Math.round(6 * sizeDelta);
  whyBits.push(`size:${size}`);

  // Locality
  if (isLocal(row, city || p.city)) {
    score += Math.round(10 * p.signalWeight.local);
    whyBits.push(`local:${city || p.city}`);
  }

  // Channel hints via tags
  const all = (row.tags || []).concat(row.segments || []).map(lc);
  if (all.includes("ecom") || all.includes("ecommerce") || all.includes("shopify")) {
    score += Math.round(3 * p.signalWeight.ecommerce);
    whyBits.push("ecom");
  }
  if (all.includes("retail")) {
    score += Math.round(2 * p.signalWeight.retail);
    whyBits.push("retail");
  }
  if (all.includes("wholesale") || all.includes("b2b")) {
    score += Math.round(2 * p.signalWeight.wholesale);
    whyBits.push("wholesale");
  }

  // simple “hot” signal: recent activity flags your builder puts in tags
  let temp: Temp = "warm";
  if (all.includes("launch") || all.includes("event") || all.includes("hiring") || all.includes("ad")) {
    score += 7;
    temp = "hot";
    whyBits.push("signal:recent");
  }

  // clamp
  score = Math.max(0, Math.min(100, score));
  return { score, temp, whyBits };
}

/** shape a BuyerRow into a Candidate without mutating the row */
function toCandidate(row: BuyerRow, p: EffectivePrefs, city?: string): Candidate {
  const { score, temp, whyBits } = scoreRow(row, p, city);
  const extra = prefsSummary(p);
  const why = `fit: ${row.segments?.slice(0, 2).join("/") || "general"} • ${whyBits.join(", ")} • ${extra}`;
  return {
    host: row.host,
    platform: "web",
    title: row.name || "Buyer",
    created: nowISO(),
    temp,
    score,
    why,
  };
}

/**
 * GET /api/leads/find-buyers?host=peekpackaging.com&city=Los%20Angeles
 * Optional: &region=US/CA&radius=50mi  (currently informational)
 */
router.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = normalizeHost(String(req.query.host || ""));
    if (!host) return res.status(400).json({ error: "host is required" });

    const city = typeof req.query.city === "string" ? req.query.city : undefined;

    // Load user prefs (defaults bias toward Tier C, small/mid, local)
    const prefs = getPrefs(host);

    // Single loader — shared/catalog exports loadCatalog() with 0 args
    const loaded = await loadCatalog(); // { rows: BuyerRow[] }
    const rows: BuyerRow[] = loaded.rows || [];

    // category allow/block first
    const filtered = rows.filter(
      (r) => categoryAllowed(r, prefs.categoriesAllow, prefs.categoriesBlock) && matchTier(r, prefs.tierFocus),
    );

    // score + pick top N (enforce maxWarm/maxHot)
    const scored = filtered.map((r) => toCandidate(r, prefs, city));

    // partition by temp, then take caps
    const warm = scored.filter((c) => c.temp === "warm").sort((a, b) => b.score - a.score).slice(0, prefs.maxWarm);
    const hot = scored.filter((c) => c.temp === "hot").sort((a, b) => b.score - a.score).slice(0, prefs.maxHot);

    // merge with hot first
    const items: Candidate[] = hot.concat(warm);

    return res.json({ items });
  } catch (err: any) {
    console.error("find-buyers error:", err?.stack || err);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;