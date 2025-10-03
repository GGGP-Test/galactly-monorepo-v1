// src/shared/ontology.ts
// Deterministic ontology + extractors for packaging.
// Pure string/regex logic, no I/O, no external deps.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CanonicalProduct =
  | "boxes" | "cartons" | "corrugate"
  | "labels"
  | "tape"
  | "film" | "shrink" | "stretch"
  | "pallets" | "trays"
  | "pouches" | "bags" | "mailer"
  | "foam"
  | "bottles" | "jars" | "closures" | "caps"
  | "rigid" | "flexible"
  | "clamshells"
  | "tins" | "cans";

export type CanonicalSector =
  | "Food"
  | "Beverage"
  | "Industrial"
  | "Automotive"
  | "Pharma"
  | "Cosmetics"
  | "Cannabis"
  | "Electronics"
  | "Apparel"
  | "Logistics"
  | "General";

/* --------------------------------- utils ---------------------------------- */

function normWords(s: string): string { return (s || "").toLowerCase(); }

function scoreHits(text: string, pats: RegExp[]): number {
  let n = 0; for (const re of pats) if (re.test(text)) n++; return n;
}

function uniqLower(a: string[]): string[] {
  const out = new Set<string>();
  for (const s of a) {
    const v = String(s || "").toLowerCase().trim();
    if (v) out.add(v);
  }
  return Array.from(out);
}

/* ------------------------------ products ---------------------------------- */

type ProductLex = { tag: CanonicalProduct; pats: RegExp[] };

const PRODUCT_LEX: ProductLex[] = [
  { tag: "boxes",      pats: [/box(es)?/i, /custom\s*box/i] },
  { tag: "cartons",    pats: [/carton(s)?/i] },
  { tag: "corrugate",  pats: [/corrugat(ed|e|ion)/i, /\bect\b/i] },
  { tag: "labels",     pats: [/label(s|ing)?/i, /\bpsa\b/i] },
  { tag: "tape",       pats: [/tape(s)?/i] },
  { tag: "film",       pats: [/\bfilm(s)?\b/i] },
  { tag: "shrink",     pats: [/shrink( wrap| film)?/i] },
  { tag: "stretch",    pats: [/stretch( wrap| film)?/i] },
  { tag: "pallets",    pats: [/pallet(s)?/i] },
  { tag: "trays",      pats: [/tray(s)?/i] },
  { tag: "pouches",    pats: [/pouch(es)?/i] },
  { tag: "bags",       pats: [/\bbag(s)?\b/i, /polybag(s)?/i] },
  { tag: "mailer",     pats: [/mailer(s)?/i, /mail(ing)?\s*bag(s)?/i] },
  { tag: "foam",       pats: [/foam/i, /cushion(ing)?/i] },
  { tag: "bottles",    pats: [/bottle(s)?/i] },
  { tag: "jars",       pats: [/jar(s)?/i] },
  { tag: "closures",   pats: [/closure(s)?/i, /child[- ]resistant/i, /\bcr\s*cap/i] },
  { tag: "caps",       pats: [/\bcap(s)?\b/i, /screwcap/i] },
  { tag: "rigid",      pats: [/rigid/i] },
  { tag: "flexible",   pats: [/flexible/i, /\bflex\s*pack/i] },
  { tag: "clamshells", pats: [/clamshell(s)?/i] },
  { tag: "tins",       pats: [/\btin(s)?\b/i] },
  { tag: "cans",       pats: [/\bcan(s)?\b/i] },
];

/** Extract normalized product tags from site text (+ optional meta keywords). */
export function productsFrom(textRaw: string, keywords?: string[]): string[] {
  const text = normWords(textRaw);
  const kw = uniqLower(keywords || []);
  const hits: Array<{ tag: CanonicalProduct; score: number }> = [];

  for (const p of PRODUCT_LEX) {
    const s = scoreHits(text, p.pats) + (kw.some(k => p.pats.some(re => re.test(k))) ? 1 : 0);
    if (s > 0) hits.push({ tag: p.tag, score: s });
  }

  hits.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (seen.has(h.tag)) continue;
    seen.add(h.tag);
    out.push(h.tag);
    if (out.length >= 12) break;
  }
  return out;
}

/* ------------------------------- sectors ---------------------------------- */

type SectorLex = { name: CanonicalSector; pats: RegExp[] };

const SECTOR_LEX: SectorLex[] = [
  { name: "Food",        pats: [/food/i, /retort/i, /\bfda\b/i, /\busda\b/i, /snack/i, /meat|dairy|produce/i] },
  { name: "Beverage",    pats: [/beverage|brew|distill|bottl(e|ing)/i, /drink|juice|soda/i] },
  { name: "Industrial",  pats: [/industrial/i, /\bmro\b/i, /maintenance/i, /warehouse/i, /pallet/i] },
  { name: "Automotive",  pats: [/automotive|auto\s?parts?/i, /tier\s?[1-3]/i] },
  { name: "Pharma",      pats: [/pharma(cy|ceutical)?/i, /\bgmp\b/i, /sterile/i] },
  { name: "Cosmetics",   pats: [/cosmetic(s)?/i, /beauty/i, /personal care/i] },
  { name: "Cannabis",    pats: [/cannabis|hemp|\bthc\b|\bcbd\b/i, /child[- ]resistant/i] },
  { name: "Electronics", pats: [/electronics?/i, /\besd\b/i, /anti[- ]static/i] },
  { name: "Apparel",     pats: [/apparel|garment|fashion/i] },
  { name: "Logistics",   pats: [/\b3pl\b|logistics|fulfillment|warehouse/i] },
];

/** Extract normalized sector/audience hints from site text (+ optional keywords). */
export function sectorsFrom(textRaw: string, keywords?: string[]): CanonicalSector[] {
  const text = normWords(textRaw);
  const kw = uniqLower(keywords || []);
  const hits: Array<{ name: CanonicalSector; score: number }> = [];

  for (const s of SECTOR_LEX) {
    const sc = scoreHits(text, s.pats) + (kw.some(k => s.pats.some(re => re.test(k))) ? 1 : 0);
    if (sc > 0) hits.push({ name: s.name, score: sc });
  }

  hits.sort((a, b) => b.score - a.score);
  const out = hits.map(h => h.name);
  if (out.length === 0) out.push("General");
  return Array.from(new Set(out)).slice(0, 6);
}

/* -------------------------------- metrics --------------------------------- */

type MetricHint = { phrase: string; re: RegExp };

const H: Record<string, MetricHint[]> = {
  general: [
    { phrase: "lead time", re: /lead[- ]time/i },
    { phrase: "moq / minimum order", re: /\bmoq\b|minimum order/i },
    { phrase: "on-time delivery", re: /on[- ]time delivery/i },
    { phrase: "unit cost per pack", re: /unit cost|cost per/i },
    { phrase: "sustainability (PCR%, recyclability)", re: /\bpcr\b|recycl/i },
    { phrase: "quality certifications (ISO, SQF)", re: /\biso\b|\bsqf\b/i },
  ],
  film: [
    { phrase: "load stability in transit", re: /load (stability|secure)/i },
    { phrase: "puncture/tear resistance", re: /puncture|tear/i },
    { phrase: "pre-stretch efficiency", re: /pre[- ]stretch/i },
  ],
  labels: [
    { phrase: "adhesion on substrate", re: /adhes(ion|ive)/i },
    { phrase: "print durability/scuff", re: /scuff|abrasion|durab/i },
    { phrase: "application alignment", re: /align(ment)?|label applicat/i },
  ],
  corrugate: [
    { phrase: "stack/edge crush strength (ECT)", re: /\bect\b|edge crush|stack strength/i },
    { phrase: "cube efficiency / freight", re: /cube|freight/i },
  ],
  bottles: [
    { phrase: "closure compatibility & torque", re: /torque|compatib(le|ility)/i },
    { phrase: "hot-fill/retort seal integrity", re: /hot[- ]fill|retort|seal integrity/i },
  ],
  closures: [
    { phrase: "child-resistant compliance", re: /child[- ]resistant|\bcr\s?cap/i },
    { phrase: "torque window / application", re: /torque|apply/i },
  ],
};

const SECTOR_DEFAULTS: Record<CanonicalSector, string[]> = {
  Food: [
    "Food-contact compliance (FDA/EC)",
    "Moisture / oxygen barrier needs",
    "Seal integrity under process (hot-fill/retort)",
  ],
  Beverage: [
    "Closure compatibility & torque",
    "Label application alignment & adhesion",
    "Bottle/secondary pack stability in transit",
  ],
  Industrial: [
    "Damage reduction targets in transit",
    "Automation line uptime impact",
    "Sustainability targets (PCR %, recyclability)",
  ],
  Automotive: [
    "ESD-safe / part protection needs",
    "Dimensional tolerance / fit in line",
    "Traceability & labeling (VIN/lot)",
  ],
  Pharma: [
    "GMP & sterile barrier requirements",
    "Lot & serial traceability (DSCSA)",
    "Tamper-evident packaging integrity",
  ],
  Cosmetics: [
    "Aesthetic clarity / scuff resistance",
    "Label/print fidelity on curved surfaces",
    "Tamper-evident & leak-proof sealing",
  ],
  Cannabis: [
    "Child-resistant compliance",
    "Odor / moisture barrier control",
    "Labeling compliance (THC %, warnings)",
  ],
  Electronics: [
    "ESD protection & handling",
    "Cushioning / drop protection",
    "Moisture barrier & desiccant control",
  ],
  Apparel: [
    "Branding/unboxing presentation",
    "Damage/return reduction in parcel",
    "Label/size ID accuracy",
  ],
  Logistics: [
    "Cube efficiency / freight class",
    "Pallet stability & wrap optimization",
    "Pick/pack scanability & labeling",
  ],
  General: [
    "Lead time commitments",
    "Minimum order quantities (MOQ)",
    "On-time delivery performance",
  ],
};

/**
 * Bottom-up hot metrics by sector, with guaranteed non-empty fallbacks.
 * Also enrich with product-specific metric families when relevant.
 */
export function metricsBySector(
  textRaw: string,
  sectors: string[],
  products: string[],
): Record<string, string[]> {
  const text = normWords(textRaw);
  const chosen = new Map<CanonicalSector, string[]>();

  const add = (sec: CanonicalSector, metric: string) => {
    const cur = chosen.get(sec) || [];
    if (!cur.includes(metric)) cur.push(metric);
    chosen.set(sec, cur);
  };

  const sectorsNorm: CanonicalSector[] =
    (sectors && sectors.length ? (sectors as CanonicalSector[]) : ["General"]);

  for (const sec of sectorsNorm) {
    const prods = new Set(products.map(p => p.toLowerCase()));

    if (prods.has("film") || prods.has("shrink") || prods.has("stretch") || prods.has("pallets")) {
      for (const h of H.film) if (h.re.test(text)) add(sec, h.phrase);
    }
    if (prods.has("labels")) {
      for (const h of H.labels) if (h.re.test(text)) add(sec, h.phrase);
    }
    if (prods.has("corrugate") || prods.has("boxes") || prods.has("cartons")) {
      for (const h of H.corrugate) if (h.re.test(text)) add(sec, h.phrase);
    }
    if (prods.has("bottles") || prods.has("jars")) {
      for (const h of H.bottles) if (h.re.test(text)) add(sec, h.phrase);
    }
    if (prods.has("closures") || prods.has("caps")) {
      for (const h of H.closures) if (h.re.test(text)) add(sec, h.phrase);
    }

    for (const g of H.general) if (g.re.test(text)) add(sec, g.phrase);

    const have = chosen.get(sec) || [];
    if (have.length < 3) {
      const def = SECTOR_DEFAULTS[sec] || SECTOR_DEFAULTS.General;
      for (const m of def) add(sec, m);
    }

    chosen.set(sec, (chosen.get(sec) || []).slice(0, 8));
  }

  if (chosen.size === 0) {
    chosen.set("General", SECTOR_DEFAULTS.General.slice(0, 6));
  }

  const out: Record<string, string[]> = {};
  for (const [k, v] of chosen.entries()) out[k] = v;
  return out;
}