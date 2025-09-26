// src/routes/leads.ts

import { Router, Request, Response } from "express";
import { EffectivePrefs, getPrefs, prefsSummary, Tier } from "../shared/prefs";
import { BuyerRow, loadCatalog } from "../shared/catalog";

export const LeadsRouter = Router();
export default LeadsRouter; // keep default for index.ts while also exporting named

// ---------- helpers -----------------------------------------------------------

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
  const size = pickSize(row);
  const sizeW = p.sizeWeight[size];
  let score = 50 + sizeW * 20;

  why.push(`size=${size}(${sizeW})`);

  const tiers = rowTiers(row);
  const focused = p.tierFocus.some(t => tiers.includes(t));
  if (focused) {
    score += 6;
    why.push(`tier∈focus[${p.tierFocus.join(",")}]`);
  } else {
    score -= 4;
    why.push(`tier∉focus`);
  }

  const cityWanted = (p.city || "").toLowerCase();
  if (cityWanted) {
    const rowCities = toLowerSet((row as any).cityTags);
    if (rowCities.has(cityWanted)) {
      score += 10 * p.signalWeight.local;
      why.push(`local:${p.city}`);
    }
  }

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

  const tags = toLowerSet((row as any).tags);
  if (tags.has("ecom") || tags.has("ecommerce")) score += 5 * p.signalWeight.ecommerce;
  if (tags.has("retail")) score += 4 * p.signalWeight.retail;
  if (tags.has("wholesale")) score += 2 * p.signalWeight.wholesale;

  score = Math.max(0, Math.min(100, score));
  return { score, whyBits: why };
}

function tempFromRow(row: BuyerRow, score: number): "hot" | "warm" {
  const sigs: string[] = ((row as any).signals || []).map((s: any) => String(s || "").toLowerCase());
  if (sigs.some(s => s.includes("launch") || s.includes("event") || s.includes("new sku"))) return "hot";
  return score >= 78 ? "hot" : "warm";
}

function makeTitle(row: BuyerRow): string {
  const name = (row as any).name || (row as any).host || "buyer";
  return `Suppliers / vendor info | ${name}`.trim();
}

type ApiItem = {
  host: string;
  platform: "web";
  title: string;
  created: string;
  temp: "warm" | "hot";
  why: string;
  score: number;
};

// ---------- route -------------------------------------------------------------

LeadsRouter.get("/api/leads/find-buyers", async (req: Request, res: Response) => {
  try {
    const host = String(req.query.host || "");
    if (!host) return res.status(400).json({ error: "host is required" });

    const base = getPrefs(host);

    const city = typeof req.query.city === "string" ? req.query.city : undefined;
    const allow = typeof req.query.allow === "string" ? req.query.allow.split(",") : [];
    const block = typeof req.query.block === "string" ? req.query.block.split(",") : [];

    const p: EffectivePrefs = {
      ...base,
      city: city || base.city,
      categoriesAllow: allow.length ? allow : base.categoriesAllow,
      categoriesBlock: block.length ? block : base.categoriesBlock,
    };

    // Load a single catalog then split by tier locally
    const all: BuyerRow[] = await loadCatalog();

    const supplierHost = host.toLowerCase();

    const ab = all.filter(r => {
      const t = rowTiers(r);
      return t.includes("A") || t.includes("B");
    });

    const tc = all.filter(r => rowTiers(r).includes("C"));

    const ordered: BuyerRow[] = p.tierFocus.includes("C") ? [...tc, ...ab] : [...ab, ...tc];

    const filtered = ordered.filter((r) => {
      const rHost = String((r as any).host || "").toLowerCase();
      if (!rHost || rHost === supplierHost) return false;
      if (p.preferSmallMid) {
        const s = pickSize(r);
        return s === "micro" || s === "small" || s === "mid";
      }
      return true;
    });

    const results: ApiItem[] = filtered.map((row) => {
      const { score, whyBits } = scoreRow(row, p);
      const temp = tempFromRow(row, score);
      const why = [
        `fit: ${((row as any).segments || []).slice(0, 3).join("/") || "general packaging"}`,
        prefsSummary(p),
        ...whyBits,
      ].join(" · ");

      return {
        host: (row as any).host || "",
        platform: "web",
        title: makeTitle(row),
        created: new Date().toISOString(),
        temp,
        why,
        score: Math.round(score),
      };
    });

    results.sort((a, b) => b.score - a.score);
    const items = results.slice(0, Math.max(p.maxWarm + p.maxHot, 10));
    res.status(200).json({ items });
  } catch (e: any) {
    res.status(500).json({ error: "find-buyers failed", detail: String(e?.message || e) });
  }
});