// src/shared/ontology.ts
//
// Lightweight packaging ontology + scorers used by /classify and step3.
// Exports:
//   - productsFrom(text, keywords?, max?) -> string[]
//   - sectorsFrom(text, keywords?, max?)  -> string[]
//   - metricsBySector: Record<string,string[]>
//
// Design goals:
//   - deterministic (no AI calls), forgiving, and fast
//   - accepts both page text and <meta keywords> as weak signals
//   - everything is simple string/regex matching; no heavy deps

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Sector =
  | "food"
  | "beverage"
  | "cosmetics"
  | "supplements"
  | "electronics"
  | "apparel"
  | "pharma"
  | "pet"
  | "automotive"
  | "home"
  | "industrial"
  | "cannabis";

/* -------------------------------------------------------------------------- */
/* Lexicons                                                                    */
/* -------------------------------------------------------------------------- */

// product groups we surface as "productTags"
const PRODUCT_LEX: Record<string, Array<string | RegExp>> = {
  boxes: ["box", "boxes", "carton", "cartons", "folding carton", "rigid box", /corrugat(?:e|ed)/i, "mailer box"],
  labels: ["label", "labels", "sticker", "stickers", "pressure sensitive"],
  tape: ["tape", "packaging tape", "opp tape"],
  pouches: ["pouch", "pouches", "stand up pouch", "stand-up pouch", "mylar"],
  film: ["film", "shrink film", "stretch film", "laminate", "laminated film", "stretch wrap", "shrink wrap"],
  mailers: ["mailer", "mailers", "poly mailer", "bubble mailer"],
  corrugate: [/corrugat(?:e|ed)/i, "flute", "ect", "mullen"],
  clamshells: ["clamshell", "clamshells", "blister"],
  foam: ["foam insert", "eva foam", "pe foam", "epe foam"],
  pallets: ["pallet", "pallets", "palletizing"],
  mailer_bags: ["bag", "bags", "polybag", "poly bag"],
  bottles: ["bottle", "bottles", "vial", "vials"],
  jars: ["jar", "jars", "tin", "tins"],
  closures: ["closure", "closures", "cap", "caps", "lug", "snap cap", "child-resistant"],
  trays: ["tray", "trays", "thermoform", "thermoformed"],
};

// sectors we hint for the persona/industries rail
const SECTOR_LEX: Record<Sector, Array<string | RegExp>> = {
  food: ["food", "grocery", "snack", "sauce", "salsa", "candy", "baked", "deli", "frozen"],
  beverage: ["beverage", "drink", "juice", "soda", "coffee", "tea", "brewery", "beer", "wine", "distillery"],
  cosmetics: ["cosmetic", "cosmetics", "beauty", "skincare", "skin care", "haircare", "makeup", "fragrance"],
  supplements: ["supplement", "nutraceutical", "vitamin", "sports nutrition"],
  electronics: ["electronics", "devices", "gadget", "semiconductor", "pcb"],
  apparel: ["apparel", "fashion", "clothing", "garment"],
  pharma: ["pharma", "pharmaceutical", "medical", "medication", /\brx\b/i, /\botc\b/i],
  pet: ["pet", "pets", "petcare", "pet care"],
  automotive: ["automotive", "auto", "aftermarket", "oem"],
  home: ["home goods", "home & garden", "furniture", "decor"],
  industrial: ["industrial", "b2b", "manufacturing", "factory", "warehouse", "fulfillment"],
  cannabis: ["cannabis", "cbd", "hemp", "dispensary"],
};

/* -------------------------------------------------------------------------- */
/* Metric library (bottom-up > general)                                       */
/* -------------------------------------------------------------------------- */

export const metricsBySector: Record<string, string[]> = {
  // shared, industry-agnostic (appended as fallback)
  general: [
    "Damage reduction targets in transit",
    "Automation line uptime impact",
    "Sustainability targets (PCR %, recyclability)",
    "Unit cost at target MOQ",
    "E-commerce fulfillment compatibility",
  ],

  corrugate: [
    "ECT / stack strength at target weight",
    "Board grade & burst/Mullen targets",
    "Die-line, folding & glue integrity",
    "Print registration & brand color accuracy",
  ],

  beverage: [
    "Closure compatibility & torque",
    "Label application alignment & adhesion",
    "Bottle/secondary pack stability in transit",
    "Cold-chain / condensation resistance",
    "Lot traceability & COA",
  ],

  food: [
    "Food-contact compliance (FDA/EC)",
    "Moisture / oxygen barrier needs",
    "Seal integrity under process (hot-fill/retort)",
    "Case-packing line uptime impact",
  ],

  cosmetics: [
    "Print finish & brand color match",
    "Decor registration (foil/emboss/deboss)",
    "Label adhesion on varnished surfaces",
    "Carton rigidity vs weight",
    "Tamper-evidence features",
  ],

  electronics: [
    "Drop/edge-crush protection at DIM weight",
    "ESD-safe packaging compliance",
    "Foam insert precision & fit",
    "Sealed-air / void-fill compatibility",
  ],

  pharma: [
    "cGMP/FDA packaging compliance",
    "Lot traceability & COA",
    "Tamper-evident seal integrity",
    "Child-resistant closure certification",
    "Serialization / GS1 barcode placement",
  ],

  cannabis: [
    "Child-resistant certification",
    "State regulatory label compliance",
    "Odor/light barrier performance",
    "Tamper-evidence integrity",
  ],

  automotive: [
    "Component scuff/scratch resistance",
    "Returnable/return-loop compatibility",
    "Line-side kitting efficiency",
  ],
};

/* -------------------------------------------------------------------------- */
/* Scoring helpers                                                             */
/* -------------------------------------------------------------------------- */

function normalize(str: string): string {
  return (str || "").toLowerCase();
}

function countHits(hay: string, needle: string | RegExp): number {
  if (!hay) return 0;
  if (typeof needle === "string") {
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    return hay.match(re)?.length || 0;
  }
  return hay.match(needle)?.length || 0;
}

function scoreLexicon(
  text: string,
  keywords: string[] | undefined,
  lex: Record<string, Array<string | RegExp>>,
): Record<string, number> {
  const hay = normalize(text);
  const keyStr = normalize((keywords || []).join(" "));
  const out: Record<string, number> = {};
  for (const [key, synonyms] of Object.entries(lex)) {
    let n = 0;
    for (const syn of synonyms) {
      n += countHits(hay, syn) + countHits(keyStr, syn);
    }
    if (n > 0) out[key] = n;
  }
  return out;
}

function topKeys(scores: Record<string, number>, max: number): string[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, max))
    .map(([k]) => k);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Extract normalized product tags (max 12) from page text + keywords. */
export function productsFrom(text: string, keywords?: string[], max = 12): string[] {
  const scores = scoreLexicon(text || "", keywords || [], PRODUCT_LEX);
  return topKeys(scores, max);
}

/** Extract sector hints (max 8) from page text + keywords. */
export function sectorsFrom(text: string, keywords?: string[], max = 8): string[] {
  const scores = scoreLexicon(text || "", keywords || [], SECTOR_LEX as any);
  return topKeys(scores, max);
}

/* -------------------------------------------------------------------------- */
/* Small utilities some routes might want                                     */
/* -------------------------------------------------------------------------- */

/** Returns a concatenated metric list for a set of sectors with general fallback. */
export function metricsForSectors(sectors: string[], maxPerSector = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const s of sectors) {
    const list = metricsBySector[s] || [];
    for (const m of list.slice(0, maxPerSector)) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
  }

  // Always ensure a few general metrics present
  for (const m of metricsBySector.general) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out.slice(0, 24);
}