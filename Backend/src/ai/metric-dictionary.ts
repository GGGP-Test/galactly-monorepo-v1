/**
 * Canonical packaging signals and seed phrases.
 * This is intentionally small; persona-engine can expand these with LLM help.
 */

export type MetricId =
  | "ILL"  // Irregular Load Likelihood (non-square pallets, mixed SKUs)
  | "CCI"  // Cold Chain Intensity
  | "DFS"  // Digital Fulfillment Stack (D2C, carts, returns)
  | "RPI"  // Rate/Parcel/Dim-Weight Sensitivity
  | "FEI"  // Fragility/Edge/Impact sensitivity
  | "SUS"  // Sustainability orientation
  | "CWB"  // Corrugated/Boxes dependency
  | "STR"  // Stretch-film automation (turntable, pre-stretch)
  | "TAP"  // Tape/banding sealing ops
  | "FNB"  // Food & Bev markers
  | "HCP"  // Health & personal care markers
  | "3PL"  // Multi-node 3PL / DC footprint
  | "HAZ"  // Hazmat / compliance markers
  | "BUL"  // Bulk/industrial bags, FIBC, liners
  | "LTL"  // LTL/FTL shipping heavy use
  | "ECO"; // Economy/cost-first posture

export interface MetricSeed {
  id: MetricId;
  weight: number;             // default prior (0..1), used as Bayesian prior
  phrases: string[];          // seed keywords/phrases to detect
}

export const METRIC_SEEDS: MetricSeed[] = [
  {
    id: "ILL",
    weight: 0.35,
    phrases: [
      "mixed sku", "assorted", "odd", "irregular", "non-square", "unstable",
      "pallet", "palletizing", "palletisation", "case mix", "rainbow pallet",
      "ecommerce assortment", "small order", "batch pick", "broken case"
    ]
  },
  {
    id: "CCI",
    weight: 0.25,
    phrases: [
      "cold chain", "refrigerated", "frozen", "gel pack", "phase-change",
      "temperature control", "thermal", "insulated shipper", "vaccine", "ice brick"
    ]
  },
  {
    id: "DFS",
    weight: 0.30,
    phrases: [
      "shopify", "woocommerce", "bigcommerce", "checkout", "returns", "rma",
      "subscription", "last mile", "parcel", "pick and pack", "fulfillment app"
    ]
  },
  {
    id: "RPI",
    weight: 0.30,
    phrases: [
      "dim", "dimensional", "right-size", "cartonization", "rate shop", "carrier mix",
      "zebra printer", "shipstation", "packsize", "void reduction"
    ]
  },
  {
    id: "FEI",
    weight: 0.20,
    phrases: [
      "fragile", "drop test", "ISTA", "shock", "impact", "edge crush", "cushion",
      "void fill", "bubble", "foam-in-bag", "air pillow"
    ]
  },
  {
    id: "SUS",
    weight: 0.15,
    phrases: [
      "recyclable", "recycled", "less plastic", "lightweight", "compostable",
      "sustainable", "paper mailer", "reusable", "circular"
    ]
  },
  {
    id: "CWB",
    weight: 0.30,
    phrases: [
      "corrugated", "rsc", "fefco", "die-cut", "carton", "boxboard", "flute",
      "e-flute", "b-flute", "kdf", "bundling", "pallet box"
    ]
  },
  {
    id: "STR",
    weight: 0.25,
    phrases: [
      "turntable", "pre-stretch", "prestretch", "automatic", "semi-automatic",
      "conveyor", "wrapping machine", "film carriage", "load securement"
    ]
  },
  {
    id: "TAP",
    weight: 0.20,
    phrases: [
      "case sealer", "carton sealer", "water-activated tape", "gummed tape",
      "OPP tape", "hand tape", "strap", "poly strapping", "steel strapping"
    ]
  },
  {
    id: "FNB",
    weight: 0.25,
    phrases: [
      "FDA", "USDA", "SQF", "HACCP", "food grade", "beverage", "brewery",
      "dairy", "produce", "meat processing"
    ]
  },
  {
    id: "HCP",
    weight: 0.20,
    phrases: [
      "cosmetics", "personal care", "skincare", "pharma", "lot traceability",
      "clean room", "sterile", "tamper evident"
    ]
  },
  {
    id: "3PL",
    weight: 0.35,
    phrases: [
      "3pl", "fulfillment center", "multinode", "dc", "distribution center",
      "ship-from-store", "micro-fulfillment", "node", "sla", "same-day"
    ]
  },
  {
    id: "HAZ",
    weight: 0.20,
    phrases: [
      "hazmat", "dangerous goods", "un38.3", "orm-d", "tdg", "imdg",
      "msds", "sds", "combustible", "corrosive"
    ]
  },
  {
    id: "BUL",
    weight: 0.20,
    phrases: [
      "fibc", "bulk bag", "super sack", "liner", "poly liner", "gaylord",
      "resin", "powder", "granule", "pellet", "valve bag"
    ]
  },
  {
    id: "LTL",
    weight: 0.20,
    phrases: [
      "ltl", "ftl", "pallet rate", "nmfc", "class", "freight", "tl carrier",
      "dock", "cross-dock", "bill of lading"
    ]
  },
  {
    id: "ECO",
    weight: 0.10,
    phrases: [
      "cost down", "reduce cost", "lower spend", "rfx", "rfq", "rebate", "benchmark"
    ]
  }
];

/** lightweight lookup for phrase -> metric ids */
export const PHRASE_TO_METRICS: Record<string, MetricId[]> = (() => {
  const map: Record<string, MetricId[]> = {};
  for (const s of METRIC_SEEDS) {
    for (const p of s.phrases) {
      const k = p.toLowerCase();
      if (!map[k]) map[k] = [];
      if (!map[k].includes(s.id)) map[k].push(s.id);
    }
  }
  return map;
})();
