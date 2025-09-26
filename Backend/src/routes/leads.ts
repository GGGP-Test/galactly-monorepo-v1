// src/routes/leads.ts
import { Router, Request, Response } from "express";
import {
  getPrefs,
  setPrefs,
  normalizeHost,
  prefsSummary,
  EffectivePrefs,
  Tier,
} from "../shared/prefs";
import { loadCatalog, BuyerRow } from "../shared/catalog";

type Temp = "warm" | "hot";

interface ApiItem {
  host: string;
  platform: "web";
  title: string;
  created: string; // ISO
  temp: Temp;
  why: string;
  score: number;
}

interface ApiPayload {
  items: ApiItem[];
}

const LeadsRouter = Router();

/**
 * GET /api/leads/find-buyers
 * Query:
 *  - host: supplier host (required)
 *  - city: optional city bias (overrides stored prefs)
 *  - tier: optional csv of A|B|C to focus on (ex: tier=C,B)
 *  - allow: optional csv categories to prefer
 *  - block: optional csv categories to avoid
 *  - maxWarm / maxHot: caps
 */
LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const rawHost = String(req.query.host || "");
    const host = normalizeHost(rawHost);
    if (!host) {
      res.status(400).json({ error: "host is required" });
      return;
    }

    // Fold any ad-hoc tweaks from query into prefs
    const tierCsv = (req.query.tier as string) || "";
    const allowCsv = (req.query.allow as string) || "";
    const blockCsv = (req.query.block as string) || "";

    const patch: Partial<EffectivePrefs> = {} as any;

    const city = (req.query.city as string) || "";
    if (city.trim()) (patch as any).city = city.trim();

    if (tierCsv) {
      const tiers = tierCsv
        .split(",")
        .map(s => s.trim().toUpperCase())
        .filter(s => s === "A" || s === "B" || s === "C") as Tier[];
      if (tiers.length) (patch as any).tierFocus = tiers;
    }

    if (allowCsv) (patch as any).categoriesAllow = csv(lowerCsv(allowCsv));
    if (blockCsv) (patch as any).categoriesBlock = csv(lowerCsv(blockCsv));

    if (req.query.maxWarm) (patch as any).maxWarm = clampNum(req.query.maxWarm, 0, 50, 5);
    if (req.query.maxHot) (patch as any).maxHot = clampNum(req.query.maxHot, 0, 5, 1);

    const prefs = setPrefs(host, patch as any); // persists in-memory

    // Load catalog rows for requested tiers
    const tiers: Tier[] = (prefs.tierFocus && prefs.tierFocus.length ? prefs.tierFocus : ["C", "B"]) as Tier[];
    const rows: BuyerRow[] = await loadCatalog(tiers);

    // Score & select
    const scored = scoreAndPick(rows, prefs);

    const payload: ApiPayload = {
      items: scored.map(s => ({
        host: s.row.host,
        platform: "web",
        title: makeTitle(s.row),
        created: new Date().toISOString(),
        temp: s.temp,
        why: s.why,
        score: Math.round(s.score),
      })),
    };

    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "internal error" });
  }
});

export default LeadsRouter;

// ----------------- helpers -----------------

function csv(s: string): string[] {
  return s
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function lowerCsv(s: string): string {
  return s
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

function clampNum(n: any, lo: number, hi: number, dflt: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return dflt;
  return Math.max(lo, Math.min(hi, x));
}

function hasTag(row: BuyerRow, tag: string): boolean {
  const t = (row.tags || []) as string[];
  return t.some(v => v.toLowerCase() === tag.toLowerCase());
}

function inAny<T extends string>(vals: T[] | undefined, set: string[]): boolean {
  if (!vals || !vals.length) return false;
  const hs = new Set(set.map(v => v.toLowerCase()));
  return vals.some(v => hs.has(String(v).toLowerCase()));
}

function makeTitle(row: BuyerRow): string {
  // Safe: name may or may not exist in type, guard with fallback
  const name = (row as any).name || row.host;
  return `Suppliers / vendor info | ${name}`;
}

type Scored = {
  row: BuyerRow;
  score: number;
  temp: Temp;
  why: string;
};

function scoreAndPick(rows: BuyerRow[], prefs: EffectivePrefs): Scored[] {
  const allow = new Set((prefs.categoriesAllow || []).map(v => v.toLowerCase()));
  const block = new Set((prefs.categoriesBlock || []).map(v => v.toLowerCase()));

  const out: Scored[] = [];

  for (const row of rows) {
    // Basic gating: avoid blocked categories if row.segments present
    const segments = ((row as any).segments || []) as string[];
    if (block.size && segments.some(s => block.has(s.toLowerCase()))) {
      continue;
    }

    // Base score
    let score = 50;

    // Locality bonus
    if (prefs.city) {
      const cityTags = ((row as any).cityTags || []) as string[];
      if (cityTags.map(s => s.toLowerCase()).includes(prefs.city.toLowerCase())) {
        score += 20 * prefs.signalWeight.local;
      }
    }

    // Category allow nudge
    if (allow.size && segments.some(s => allow.has(s.toLowerCase()))) {
      score += 10;
    }

    // Tier alignment nudge (row.tiers might be missing; be defensive)
    const rowTiers = ((row as any).tiers || []) as Tier[];
    if (rowTiers.some(t => prefs.tierFocus.includes(t))) {
      score += 8;
    }

    // Size weighting (optional; if row.size present)
    const size = String((row as any).size || "").toLowerCase();
    if (size in prefs.sizeWeight) {
      score += 10 * (prefs.sizeWeight as any)[size];
    }

    // Hot/warm heuristic: prefer explicit signals if present; else tags hint
    const hotSignal = Boolean((row as any).signals?.hot);
    const warmSignal = Boolean((row as any).signals?.warm);
    const looksHot =
      hotSignal ||
      hasTag(row, "launch") ||
      hasTag(row, "product-launch") ||
      hasTag(row, "event") ||
      hasTag(row, "rebrand");

    const temp: Temp = looksHot ? "hot" : "warm";
    if (temp === "hot") score += 25;
    else if (warmSignal) score += 8;

    const whyBits: string[] = [
      `fit: tier ${rowTiers.length ? rowTiers.join("/") : "n/a"}`,
      prefs.city ? `city:${prefs.city}` : "",
      allow.size ? `allow:${[...allow].slice(0, 3).join("/")}` : "",
    ].filter(Boolean);

    out.push({
      row,
      score,
      temp,
      why: `${prefsSummary(prefs)} • ${whyBits.join(" • ")}`.replace(/\s+•\s*$/, ""),
    });
  }

  // Sort high to low
  out.sort((a, b) => b.score - a.score);

  // Cap by temp groups
  const warm: Scored[] = [];
  const hot: Scored[] = [];
  for (const s of out) {
    if (s.temp === "hot") {
      if (hot.length < prefs.maxHot) hot.push(s);
    } else {
      if (warm.length < prefs.maxWarm) warm.push(s);
    }
  }

  // Return hot first then warm to match UI expectations
  return [...hot, ...warm];
}

export { LeadsRouter };