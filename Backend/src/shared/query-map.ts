// src/shared/query-map.ts
//
// Build smart query seeds for web buyer discovery, based on persona tags,
// sectors, and the seed host. Dependency-free; safe to import anywhere.
//
// How to use (next step, not now):
//   import { buildQuerySeeds } from "../shared/query-map";
//   const queries = buildQuerySeeds({ hostSeed: host, prefsLikeTags, categoriesAllow });
//   Sources.findBuyersFromWeb({ hostSeed: host, city, size, limit, queries });
//
// This file is passive until you pass its queries to findBuyersFromWeb.

type Str = string;

export type QueryInput = {
  hostSeed?: Str;
  city?: Str;
  likeTags?: Str[];          // e.g. ["beverage","labels","food"]
  categoriesAllow?: Str[];   // same as persona categories
  sectors?: Str[];           // optional
  maxQueries?: number;       // default 18
};

const DEFAULT_GENERAL = [
  "cafe", "coffee shop", "bakery", "delicatessen",
  "restaurant", "juice bar", "tea shop",
  "grocery", "convenience store", "candy shop",
  "ice cream shop", "beverage store"
];

// light synonyms to widen intent just a bit
const SYN: Record<string, string[]> = {
  beverage: ["beverage brand","drink brand","juice company","soda brand","kombucha","cold brew"],
  food: ["food brand","meal prep","catering company","deli","butcher","bodega","farm shop"],
  coffee: ["coffee roaster","espresso bar","coffee truck"],
  bakery: ["patisserie","bread bakery","cake shop","cupcake shop","macaron"],
  dessert: ["dessert shop","gelato","frozen yogurt"],
  icecream: ["ice cream shop","gelato shop"],
  grocery: ["superette","market","organic market"],
  label: ["beverage brand","craft brewery","sauce brand","cosmetics brand"],
  cosmetics: ["cosmetics brand","skincare brand","beauty brand"],
  candle: ["candle brand","home fragrance brand"],
  soap: ["soap brand","personal care brand"],
  ecommerce: ["online store","shopify store","web shop"],
  wholesale: ["distributor","wholesaler"],
  retail: ["retail store","specialty shop"]
};

// persona tag → seed buckets
const TAG_TO_SEEDS: Record<string, string[]> = {
  beverage: [...SYN.beverage, "beverage store","bottle shop"],
  food: [...SYN.food, "gourmet shop","food hall","food truck"],
  labels: [...SYN.label],
  film: ["packaging film user","co-packer","co-manufacturing"],
  coffee: [...SYN.coffee, "cafe"],
  bakery: [...SYN.bakery],
  dessert: [...SYN.dessert],
  icecream: [...SYN.icecream],
  grocery: [...SYN.grocery, "corner store"],
  retail: [...SYN.retail],
  wholesale: [...SYN.wholesale],
  ecommerce: [...SYN.ecommerce],
  cosmetics: [...SYN.cosmetics],
  candle: [...SYN.candle],
  soap: [...SYN.soap]
};

// pull a couple of hints out of the seed domain
function tokensFromHost(host?: string): string[] {
  const h = String(host || "").toLowerCase();
  const stem = h.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
  const name = stem.split(".")[0];
  const bits = name.split(/[-_]/g).filter(Boolean);
  const add: string[] = [];
  for (const b of bits) {
    if (/pack(ag|ing)/.test(b)) add.push("labels","packaging buyer");
    if (/label/.test(b)) add.push("labels","bottle brand","beverage");
    if (/print/.test(b)) add.push("labels","stickers","packaging buyer");
    if (/pack/.test(b)) add.push("wholesale","distributor","co-packer");
    if (/film/.test(b)) add.push("co-packer","co-manufacturer");
  }
  return Array.from(new Set(add)).slice(0, 6);
}

function uniq<T>(arr: T[]): T[] { return Array.from(new Set(arr)); }

function boostCity(q: string, city?: string): string {
  const c = (city || "").trim();
  if (!c) return q;
  // “near {city}” bias plays nicely with both Places and OSM
  return `${q} near ${c}`;
}

/**
 * Build query seeds ordered by specificity → general.
 * We cap length conservatively; Sources will still dedupe results.
 */
export function buildQuerySeeds(input: QueryInput): string[] {
  const maxQueries = Math.max(4, Math.min(40, Number(input.maxQueries ?? 18)));

  const like = (input.likeTags || []).map(s => s.toLowerCase());
  const cats = (input.categoriesAllow || []).map(s => s.toLowerCase());
  const secs = (input.sectors || []).map(s => s.toLowerCase());
  const bag = uniq([...like, ...cats, ...secs]);

  // gather persona-driven seeds
  const personaSeeds: string[] = [];
  for (const tag of bag) {
    const k = tag.replace(/\s+/g, "");
    if (TAG_TO_SEEDS[k]) personaSeeds.push(...TAG_TO_SEEDS[k]);
    // light heuristics
    if (/beverag|drink|brew|soda|kombucha/.test(tag)) personaSeeds.push(...TAG_TO_SEEDS["beverage"]);
    if (/food|snack|cpg/.test(tag)) personaSeeds.push(...TAG_TO_SEEDS["food"]);
    if (/label|print/.test(tag)) personaSeeds.push(...TAG_TO_SEEDS["labels"]);
    if (/cosmetic|beauty|skincare/.test(tag)) personaSeeds.push(...TAG_TO_SEEDS["cosmetics"]);
  }

  // host-derived hints (often “packaging/labels” vendors)
  const hostHints = tokensFromHost(input.hostSeed);

  // final assembly: persona → host hints → safe general
  const assembled = uniq([
    ...personaSeeds,
    ...hostHints,
    ...DEFAULT_GENERAL
  ])
  // de-noise: short tokens like "store" alone are too broad
  .filter(q => /\s/.test(q) || q.length > 6)
  .slice(0, maxQueries);

  // add city bias but keep raw forms too (50/50 split)
  const half = Math.max(2, Math.floor(assembled.length / 2));
  const withCity = assembled.slice(0, half).map(q => boostCity(q, input.city));
  const without = assembled.slice(half);
  return uniq([...withCity, ...without]).slice(0, maxQueries);
}

export default { buildQuerySeeds };