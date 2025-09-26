// src/shared/catalog.ts
// Load buyer catalogs from env secrets and provide a scorer/filter.

import type { EffectivePrefs, Tier, SizeBucket } from "./prefs";
import fs from "fs";

export interface BuyerRow {
  host: string;
  name?: string;
  tiers?: Tier[];                // ["A"] | ["B"] | ["C"] (default ["C"])
  segments?: string[];           // "food","beauty","industrial","pharma",...
  tags?: string[];               // generic keyword tags
  cityTags?: string[];           // ["seattle","wa","bellevue"]
  sizeHint?: SizeBucket;         // heuristic size
  platform?: "web";
}

export interface CatalogDoc {
  version?: number;
  buyers: BuyerRow[];
}

export interface Candidate {
  host: string;
  platform: "web";
  title: string;
  created: string;               // ISO
  temp: "warm" | "hot";
  why: string;
  score: number;
}

function safeParse(json?: string | null): CatalogDoc {
  if (!json) return { buyers: [] };
  try {
    const o = JSON.parse(json);
    if (o && Array.isArray(o.buyers)) return o as CatalogDoc;
    if (Array.isArray(o)) return { buyers: o as BuyerRow[] };
    return { buyers: [] };
  } catch {
    return { buyers: [] };
  }
}

function readFileIfExists(p?: string): string | undefined {
  if (!p) return undefined;
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {}
  return undefined;
}

export function loadCatalog() {
  // Values (JSON strings) – provided via Northflank group secrets
  const abJson = process.env.BUYERS_CATALOG_TIER_AB_JSON;
  const cJson  = process.env.BUYERS_CATALOG_TIER_C_JSON;

  // Optional city JSONL file mount
  // Use NF secret file mount -> set BUYERS_CATALOG_CITY_FILE to absolute path
  const cityPath = process.env.BUYERS_CATALOG_CITY_FILE;
  const cityJsonl = readFileIfExists(cityPath);

  const ab = safeParse(abJson);
  const c  = safeParse(cJson);

  const buyers: BuyerRow[] = []
    .concat(ab.buyers || [])
    .concat(c.buyers || []);

  // Merge in city JSONL rows (each line is a BuyerRow JSON)
  if (cityJsonl) {
    for (const line of cityJsonl.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const row = JSON.parse(s) as BuyerRow;
        if (row && row.host) buyers.push(row);
      } catch {}
    }
  }

  // Normalize minimal fields
  for (const b of buyers) {
    b.platform = "web";
    if (!b.tiers || !b.tiers.length) b.tiers = ["C"];
    if (!b.segments) b.segments = [];
    if (!b.tags) b.tags = [];
    if (!b.cityTags) b.cityTags = [];
  }

  return { buyers };
}

function sizeScore(size: SizeBucket | undefined, weights: Record<SizeBucket, number>): number {
  if (!size) return 0;
  return weights[size] || 0;
}

function intersects(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || !a.length || !b.length) return false;
  const set = new Set(a.map(s => s.toLowerCase()));
  for (const x of b) if (set.has(x.toLowerCase())) return true;
  return false;
}

function tierMatch(tiers: Tier[] | undefined, focus: Tier[]): boolean {
  if (!tiers || !tiers.length) return focus.includes("C");
  return tiers.some(t => focus.includes(t));
}

export function queryCatalog(prefs: EffectivePrefs, limit = 10): Candidate[] {
  const { buyers } = loadCatalog();
  const nowIso = new Date().toISOString();

  const results: Candidate[] = [];

  for (const b of buyers) {
    // Tier filter
    if (!tierMatch(b.tiers, prefs.tierFocus)) continue;

    // Category allow/block
    const allowOk =
      (prefs.categoriesAllow.length === 0) ||
      intersects(prefs.categoriesAllow, b.segments) ||
      intersects(prefs.categoriesAllow, b.tags);

    if (!allowOk) continue;

    if (prefs.categoriesBlock.length) {
      const blocked =
        intersects(prefs.categoriesBlock, b.segments) ||
        intersects(prefs.categoriesBlock, b.tags);
      if (blocked) continue;
    }

    // Start score
    let score = 0;

    // Prefer small/mid
    score += sizeScore(b.sizeHint, prefs.sizeWeight);

    // Signals
    if (prefs.city && b.cityTags && b.cityTags.length) {
      if (b.cityTags.map(s => s.toLowerCase()).includes(prefs.city.toLowerCase())) {
        score += prefs.signalWeight.local;
      }
    }
    if (b.tags && b.tags.includes("ecommerce")) score += prefs.signalWeight.ecommerce;
    if (b.tags && b.tags.includes("retail"))    score += prefs.signalWeight.retail;
    if (b.tags && b.tags.includes("wholesale")) score += prefs.signalWeight.wholesale;

    // Tiny penalty if sizeHint is large and preferSmallMid is true
    if (prefs.preferSmallMid && b.sizeHint === "large") score -= 1.5;

    // Title/why
    const title = `Suppliers / vendor info | ${b.name || b.host}`;
    const whyParts = [
      `fit: ${ (b.segments||[]).slice(0,3).join("/") || "general packaging" }`,
      prefs.city ? `city preference: ${prefs.city}` : undefined,
    ].filter(Boolean);
    const why = whyParts.join(" · ");

    results.push({
      host: b.host,
      platform: "web",
      title,
      created: nowIso,
      temp: "warm",
      why,
      score,
    });
  }

  // Sort by score desc
  results.sort((a, b) => b.score - a.score);

  // Cap
  return results.slice(0, Math.max(1, limit));
}