// src/routes/leads.ts

import { Router, Request, Response } from "express";
import { EffectivePrefs, getPrefs, prefsSummary, Tier } from "../shared/prefs";
import { BuyerRow, loadABCatalog, loadTierCCatalog } from "../shared/catalog";

export const LeadsRouter = Router();

// ---- helpers ---------------------------------------------------------------

const isTier = (x: any): x is Tier => x === "A" || x === "B" || x === "C";

function toLowerSet(arr?: string[]): Set<string> {
  const s = new Set<string>();
  for (const v of arr || []) {
    const t = String(v || "").toLowerCase().trim();
    if (t) s.add(t);
  }
  return s;
}

function rowTiers(row: BuyerRow): Tier[] {
  const src: any[] = (row as any).tiers || [];
  return src.filter(isTier) as Tier[];
}

function pickSize(row: BuyerRow): "micro" | "small" | "mid" | "large" {
  const v = (row as any).size;
  if (v === "micro" || v === "small" || v === "mid" || v === "large") return v;
  return "mid";
}

function scoreRow(row: BuyerRow, p: EffectivePrefs): { score: number; whyBits: string[] } {
  const why: string[] = [];

  // size bias (strongly push away "large")
  const size = pickSize(row);
  const sizeW = p.sizeWeight[size];
  let score = 50 + sizeW * 20; // center at 50, size shifts ±

  why.push(`size=${size}(${sizeW})`);

  // tier focus bonus/penalty
  const tiers = rowTiers(row);
  const focused = p.tierFocus.some(t => tiers.includes(t));
  if (focused) {
    score += 6;
    why.push(`tier∈focus[${p.tierFocus.join(",")}]`);
  } else {
    score -= 4;
    why.push(`tier∉focus`);
  }

  // locality
  const cityWanted = (p.city || "").toLowerCase();
  if (cityWanted) {
    const rowCities = toLowerSet((row as any).cityTags);
    if (rowCities.has(cityWanted)) {
      score += 10 * p.signalWeight.local;
      why.push(`local:${p.city}`);
    }
  }

  // categories allow/block via tags + segments
  const allow = toLowerSet(p.categoriesAllow);
  const block = toLowerSet(p.categoriesBlock);
  if (allow.size || block.size) {
    const tags = toLowerSet((row as any).tags);
    const segs = toLowerSet((row as any).segments);
    const all = new Set<string>([...Array.from(tags), ...Array.from(segs)]);
    let allowedHit = false;
    let blockedHit = false;
    for (const v of all) {
      if (allow.has(v)) allowedHit = true;
      if (block.has(v)) blockedHit = true;
    }
    if (allowedHit) {
      score += 8;
      why.push(`allow✓`);
    }
    if (blockedHit) {
      score -= 15;
      why.push(`block✗`);
    }
  }

  // tiny nudges for channel tags
  const tags = toLowerSet((row as any).tags);
  if (tags.has("ecom") || tags.has("ecommerce")) score += 5 * p.signalWeight.ecommerce;
  if (tags.has("retail")) score += 4 * p.signalWeight.retail;
  if (tags.has("wholesale")) score += 2 * p.signalWeight.wholesale;

  // clamp to 0..100
  score = Math.max(0, Math.min(100, score));
  return { score, whyBits: why };
}

function tempFromRow(row: BuyerRow, score: number): "hot" | "warm" {
  // If the catalog supplied explicit signals, honor them lightly
  const sigs: string[] = ((row as any).signals || []).map((s: any) => String(s || "").toLowerCase());
  if (sigs.some(s => s.includes("launch") || s.includes("event") || s.includes("new sku"))) return "hot";
  // Otherwise make it score-driven
  return score >= 78 ? "hot" : "warm";
}

function makeTitle(row: BuyerRow): string {
  const name = (row as any).name || (row as any).host || "buyer";
  const host = (row as any).host || "";
  return `Suppliers / vendor info | ${name || host}`.trim();
}

type ApiItem = {
  host: string;
  platform: "web";
  title: string;
  created: string;      // ISO
  temp: "warm" | "hot";
  why: string;
  score: number;
};

// ---- route ------------------------------------------------------------------

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = String(req.query.host || "");
    if (!host) {
      res.status(400).json({ error: "host is required" });
      return;
    }

    // Pull user prefs (already have strong defaults that bias Tier C/small-mid)
    const prefs = getPrefs(host);

    // Optional ad-hoc per-request patches (city, radius, simple category filters)
    const city = typeof req.query.city === "string" ? req.query.city : undefined;
    const allow = typeof req.query.allow === "string" ? req.query.allow.split(",") : [];
    const block = typeof req.query.block === "string" ? req.query.block.split(",") : [];

    const effective: EffectivePrefs = {
      ...prefs,
      city: city || prefs.city,
      categoriesAllow: allow.length ? allow : prefs.categoriesAllow,
      categoriesBlock: block.length ? block : prefs.categoriesBlock,
    };

    // Load catalogs
    const [ab, tc] = await Promise.all([loadABCatalog(), loadTierCCatalog()]);
    // Merge with preference ordering (Tier C first if focused)
    const focusC = effective.tierFocus.includes("C");
    const rows: BuyerRow[] = focusC ? [...tc, ...ab] : [...ab, ...tc];

    // Filter out the supplier itself and very large buyers if user prefers small/mid
    const supplierHost = host.toLowerCase();
    const filtered = rows.filter((r) => {
      const rHost = String((r as any).host || "").toLowerCase();
      if (!rHost || rHost === supplierHost) return false;
      if (effective.preferSmallMid) {
        const s = pickSize(r);
        return s === "micro" || s === "small" || s === "mid";
      }
      return true;
    });

    // Score & map
    const scored: ApiItem[] = filtered.map((row) => {
      const { score, whyBits } = scoreRow(row, effective);
      const temp = tempFromRow(row, score);
      const title = makeTitle(row);
      const why = [
        `fit: ${((row as any).segments || []).slice(0, 3).join("/") || "general packaging"}`,
        prefsSummary(effective),
        ...whyBits,
      ].join(" · ");

      return {
        host: (row as any).host || "",
        platform: "web",
        title,
        created: new Date().toISOString(),
        temp,
        why,
        score: Math.round(score),
      };
    });

    // Sort, cap, respond
    scored.sort((a, b) => b.score - a.score);
    const items = scored.slice(0, Math.max(effective.maxWarm + effective.maxHot, 10));

    res.status(200).json({ items });
  } catch (err: any) {
    // Keep error body simple for the client panel
    res.status(500).json({ error: "find-buyers failed", detail: String(err?.message || err) });
  }
});