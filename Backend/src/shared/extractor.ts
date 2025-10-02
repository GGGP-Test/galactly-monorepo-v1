// src/shared/extractor.ts
//
// Deterministic extraction helpers used by /api/classify.
// Works with your curated ontology when present, and gracefully
// degrades to sensible defaults when it isn't. No external APIs.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScoreMap = Map<string, number>;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function topK(map: ScoreMap, k = 12, min = 1): string[] {
  return [...map.entries()]
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([k]) => k);
}
function singularize(w: string): string {
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function canonicalSector(s: string): string {
  if (/bev/i.test(s)) return "beverage";
  if (/auto/i.test(s)) return "automotive";
  if (/cosmet/i.test(s)) return "cosmetics";
  return s;
}
function rxToLabel(rx: RegExp): string | null {
  const src = String(rx.source || "");
  if (/torque|closure/i.test(src)) return "closure compatibility & torque";
  if (/adhes/i.test(src) && /label/i.test(src))
    return "label application alignment & adhesion";
  if (/stability|transit|secondary/i.test(src))
    return "pack stability in transit";
  if (/lead.?time/i.test(src)) return "lead time reliability";
  if (/moisture|oxygen|barrier/i.test(src))
    return "moisture / oxygen barrier needs";
  if (/seal|retort|hot.?fill/i.test(src))
    return "seal integrity under process (hot-fill/retort)";
  return null;
}

// Load ontology (shape is flexible). Using require+any keeps TS happy if
// names change; we just probe for what exists.
const Ont: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("./ontology");
  } catch {
    return {};
  }
})();

function pick<T>(name: string, fallback: T): T {
  return (Ont && name in Ont ? (Ont as any)[name] : fallback) as T;
}

/* ---------------------------- Defaults (fallback) --------------------------- */

const DEFAULT_PRODUCTS = [
  "tape", "labels", "label", "corrugate", "corrugated", "box", "boxes",
  "mailer", "mailers", "pallet", "pallets", "film", "shrink", "stretch",
  "foam", "trays", "tray", "pouch", "pouches", "bottle", "bottles",
  "jar", "jars", "closure", "closures", "cap", "caps", "clamshell",
  "clamshells", "tin", "tins", "can", "cans", "bag", "bags", "carton",
  "cartons", "wrap", "wrapping",
];

const DEFAULT_SECTORS = [
  "beverage", "food", "industrial", "automotive", "cosmetics", "pharma",
  "cannabis", "electronics", "apparel", "logistics", "warehouse",
  "chemical", "retail", "ecommerce", "personal care", "household",
  "pet", "medical",
];

const DEFAULT_METRICS: Record<string, string[]> = {
  generic: [
    "lead time reliability",
    "MOQ flexibility",
    "damage reduction targets in transit",
    "automation line uptime impact",
    "sustainability targets (PCR %, recyclability)",
  ],
  beverage: [
    "closure compatibility & torque",
    "label application alignment & adhesion",
    "bottle/secondary pack stability in transit",
  ],
  food: [
    "food-contact compliance (FDA/EC)",
    "moisture / oxygen barrier needs",
    "seal integrity under process (hot-fill/retort)",
  ],
  industrial: [
    "load stability on pallets (irregular shapes)",
    "puncture/abrasion resistance around sharp edges",
    "warehouse handling efficiency (wrap cycles, film yield)",
  ],
  automotive: [
    "line-side handling durability",
    "clean-room or low-particulate packaging",
    "part protection during shipment (vibration/impact)",
  ],
};

/* ------------------------------- Extraction -------------------------------- */

export function sectorsFrom(text: string, keywords: string[] = []): string[] {
  const base = pick<string[]>("SECTORS", DEFAULT_SECTORS).map((s) => s.toLowerCase());
  const tokens = norm(text + " " + keywords.join(" ")).split(/\s+/);
  const score: ScoreMap = new Map();

  for (const s of base) {
    const parts = s.split(/\s+/);
    let hits = 0;
    for (const p of parts) {
      hits += tokens.filter((t) => t === p).length;
    }
    if (hits) score.set(s, (score.get(s) || 0) + hits);
  }

  if (typeof Ont?.sectorsFrom === "function") {
    for (const s of (Ont.sectorsFrom(text, keywords) as string[]) || []) {
      const k = String(s).toLowerCase();
      score.set(k, (score.get(k) || 0) + 2);
    }
  }

  const top = topK(score, 8, 1);
  return top.length ? top : ["general"];
}

export function productsFrom(text: string, keywords: string[] = []): string[] {
  const base = pick<string[]>("PRODUCTS", DEFAULT_PRODUCTS).map((s) => s.toLowerCase());
  const tokens = norm(text + " " + keywords.join(" ")).split(/\s+/);
  const score: ScoreMap = new Map();

  for (const w of base) {
    const plural = w.endsWith("s") ? w : `${w}s`;
    const singular = w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
    const hits =
      tokens.filter((t) => t === w || t === plural || t === singular).length;
    if (hits) score.set(w, (score.get(w) || 0) + hits);
  }

  if (typeof Ont?.productsFrom === "function") {
    for (const p of (Ont.productsFrom(text, keywords) as string[]) || []) {
      const k = String(p).toLowerCase();
      score.set(k, (score.get(k) || 0) + 2);
    }
  }

  const items = topK(score, 12, 1).map((s) => singularize(s));
  return Array.from(new Set(items));
}

export function metricsBySector(
  text: string,
  sectors: string[],
  products: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const t = text.toLowerCase();

  // Optional ontology-provided structures
  const PAT = pick<Record<string, RegExp[]>>("METRIC_PATTERNS", {});
  const LEX = pick<Record<string, string[]>>("METRICS", DEFAULT_METRICS);

  for (const raw of (sectors.length ? sectors : ["general"])) {
    const sector = raw.toLowerCase();
    const friendlyKey = canonicalSector(sector);
    const hits = new Set<string>();

    // 1) ontology hook
    if (typeof Ont?.extractMetrics === "function") {
      try {
        for (const m of (Ont.extractMetrics(text, sector, products) as string[]) || []) {
          if (m) hits.add(String(m));
        }
      } catch {
        /* ignore */
      }
    }

    // 2) regex patterns per sector
    const sectorPat = (PAT[sector] || PAT[friendlyKey] || []) as RegExp[];
    for (const rx of sectorPat) {
      if (rx.test(t)) {
        const label = rxToLabel(rx);
        if (label) hits.add(label);
      }
    }

    // 3) fallback dictionary (never empty)
    const fall = LEX[sector] || LEX[friendlyKey] || LEX.generic || [];
    for (const m of fall) hits.add(m);

    // 4) light specialization using products
    if (sector === "industrial" && products.some((p) => /film|shrink|stretch/.test(p))) {
      hits.add("load stability on pallets (irregular shapes)");
      hits.add("film yield per pallet (wrap cycles)");
    }
    if (sector === "beverage" && products.some((p) => /closure|cap/.test(p))) {
      hits.add("closure compatibility & torque");
    }

    out[titleCase(sector)] = Array.from(hits).slice(0, 9);
  }

  return out;
}

/* ------------------------------- Re-exports -------------------------------- */

export default {
  productsFrom,
  sectorsFrom,
  metricsBySector,
};