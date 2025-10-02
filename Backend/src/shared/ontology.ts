// src/shared/ontology.ts
//
// Deterministic, dependency-free ontology helpers for packaging.
// Exports the three functions expected by routes/classify.ts:
//   - productsFrom(text, keywords?) => string[]
//   - sectorsFrom(text, keywords?)  => string[]
//   - metricsBySector(text, sectors, productTags) => Record<string,string[]>
//
// Design notes
// ------------
// • We normalize text and count token hits with word-boundary regexes.
// • Products and sectors are derived from both page text and meta keywords.
// • metricsBySector() follows a bottom-up strategy:
//      1) sector-specific deep metrics (when available)
//      2) product-specific technical metrics (based on detected products)
//      3) generic ops metrics (never leaves a sector empty)
// • All outputs are lowercased, unique, human-ready phrases.
// • No external libs; safe for server-only usage.

type Counter = Map<string, number>;

function normalize(s: string): string {
  return (s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function toBag(text: string, keywords?: string[]): string {
  const kw = (keywords || [])
    .map(k => String(k || "").toLowerCase().trim())
    .filter(Boolean)
    .join(" ");
  return `${text || ""} ${kw}`.toLowerCase();
}

function bump(counter: Counter, key: string, n = 1) {
  counter.set(key, (counter.get(key) || 0) + n);
}

function rank(counter: Counter, limit = 12): string[] {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}

function take<T>(a: T[], n: number): T[] {
  return a.length > n ? a.slice(0, n) : a;
}

// ---------------------------------------------------------------------------
// Canonical product tags (normalized) with synonym patterns
// ---------------------------------------------------------------------------
const PRODUCT_CANON: Record<string, string[]> = {
  // flexible + films
  "film": ["film", "films"],
  "shrink": ["shrink", "shrinkwrap", "shrink wrap", "shrink-film", "shrink film"],
  "stretch": ["stretch", "stretchwrap", "stretch wrap"],
  "pouches": ["pouch", "pouches", "standup pouch", "stand-up pouch"],
  // corrugate / rigid pack / components
  "boxes": ["box", "boxes", "carton", "cartons", "corrugate", "corrugated"],
  "labels": ["label", "labels", "labeling"],
  "tape": ["tape", "tapes"],
  "pallets": ["pallet", "pallets"],
  "closures": ["closure", "closures", "cap", "caps", "lids", "lid"],
  "bottles": ["bottle", "bottles"],
  "jars": ["jar", "jars"],
  "trays": ["tray", "trays", "clamshell", "clamshells"],
  "foam": ["foam", "foam-in-place", "fip"],
};

function buildProductRegex(): Record<string, RegExp[]> {
  const out: Record<string, RegExp[]> = {};
  for (const [canon, syns] of Object.entries(PRODUCT_CANON)) {
    out[canon] = syns.map(
      w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    );
  }
  return out;
}

const PRODUCT_RE = buildProductRegex();

// ---------------------------------------------------------------------------
// Canonical sectors with synonym patterns
// ---------------------------------------------------------------------------
const SECTOR_CANON: Record<string, string[]> = {
  "beverage": ["beverage", "brewery", "distillery", "winery", "drinks", "drink"],
  "food": ["food", "snack", "dairy", "meat", "bakery", "confectionery"],
  "industrial": ["industrial", "manufacturing", "factory", "warehouse", "warehousing"],
  "automotive": ["automotive", "auto", "vehicle", "tier 1", "tier-1"],
  "cosmetics": ["cosmetic", "cosmetics", "beauty", "skincare", "makeup"],
  "pharma": ["pharma", "pharmaceutical", "biotech", "life science", "life-science"],
  "electronics": ["electronics", "electronic", "semiconductor", "ems", "pcb"],
  "cannabis": ["cannabis", "cbd", "hemp", "dispensary"],
};

function buildSectorRegex(): Record<string, RegExp[]> {
  const out: Record<string, RegExp[]> = {};
  for (const [canon, syns] of Object.entries(SECTOR_CANON)) {
    out[canon] = syns.map(
      w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
    );
  }
  return out;
}

const SECTOR_RE = buildSectorRegex();

// ---------------------------------------------------------------------------
// Product- and sector-specific deep metrics
// (phrases are written in human language for the UI)
// ---------------------------------------------------------------------------
const GENERIC_OPS_METRICS = [
  "on-time delivery (OTD)",
  "MOQ & price breaks",
  "quality defects (ppm)",
];

const PRODUCT_METRICS: Record<string, string[]> = {
  film: [
    "load containment force",
    "puncture resistance",
    "coefficient of friction (cling/COF)",
    "wrap speed on line",
    "gauge & yield optimization",
  ],
  shrink: [
    "shrink ratio & recovery",
    "seal strength after shrink",
    "perforation/vent pattern",
  ],
  stretch: [
    "edge tear resistance",
    "pre-stretch percentage",
    "film memory & rebound",
  ],
  labels: [
    "adhesive type vs temperature range",
    "print durability (scuff/solvent)",
    "applicator speed compatibility",
  ],
  boxes: [
    "edge crush (ECT)",
    "box compression strength (BCT)",
    "die-cut tolerances & score quality",
  ],
  closures: [
    "application & removal torque",
    "liner type and leak rate",
    "neck finish compatibility",
  ],
  bottles: [
    "neck finish tolerance",
    "wall thickness consistency",
    "clarity/haze targets",
  ],
  jars: [
    "seal integrity under hot-fill",
    "vacuum/pressure hold",
  ],
  pouches: [
    "seal strength & delamination risk",
    "oxygen transmission rate (OTR)",
    "retort/hot-fill compatibility",
  ],
  pallets: [
    "footprint & deck board spec",
    "dynamic vs static load rating",
  ],
  foam: [
    "density & ILD",
    "cushion curves vs drop height",
  ],
  trays: [
    "cell geometry & crush resistance",
    "hinge strength (for clamshells)",
  ],
  tape: [
    "adhesion/peel vs surface energy",
    "shear strength under load",
  ],
};

const SECTOR_DEEP_METRICS: Record<string, string[]> = {
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
    "damage reduction targets in transit",
    "automation line uptime impact",
    "sustainability targets (PCR %, recyclability)",
  ],
  automotive: [
    "component surface protection (scratch/scuff)",
    "just-in-time delivery stability",
    "line-side pack density & ergonomics",
  ],
  cosmetics: [
    "display clarity & scuff resistance",
    "tamper-evidence & seal aesthetics",
    "unit cost vs luxury feel",
  ],
  pharma: [
    "USP/Ph. Eur. compliance",
    "sterility assurance level (SAL)",
    "serialization & traceability",
  ],
  electronics: [
    "ESD protection targets",
    "shock/vibration mitigation",
    "dimensional repeatability in trays",
  ],
  cannabis: [
    "child-resistant compliance",
    "odor barrier performance",
    "state-by-state label rules",
  ],
  // fallback bucket used when sector == "general"
  general: [
    "packaging cost per unit",
    "damage/returns reduction",
    "shelf or unboxing presentation",
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return normalized product tags ranked by frequency. */
export function productsFrom(text: string, keywords?: string[]): string[] {
  const bag = toBag(text, keywords);
  const c: Counter = new Map();

  for (const [canon, res] of Object.entries(PRODUCT_RE)) {
    for (const r of res) {
      if (r.test(bag)) bump(c, canon);
    }
  }

  // small boost when a product appears near obvious commerce cues
  const commerce = /\b(price|catalog|shop|store|sku|buy|quote|rfq|rfqs)\b/i.test(bag);
  if (commerce) {
    for (const k of c.keys()) bump(c, k, 0.25);
  }

  const ranked = rank(c, 12);
  return ranked;
}

/** Return normalized sector hints ranked by frequency; guarantees at least one value. */
export function sectorsFrom(text: string, keywords?: string[]): string[] {
  const bag = toBag(text, keywords);
  const c: Counter = new Map();

  for (const [canon, res] of Object.entries(SECTOR_RE)) {
    for (const r of res) {
      if (r.test(bag)) bump(c, canon);
    }
  }

  // Heuristics: if product list looks B2C-adjacent, nudge food/beverage/cosmetics
  const b2cNudge = /\b(brand|store|menu|recipe|fragrance|drink|snack)\b/i.test(bag);
  if (b2cNudge) {
    bump(c, "food", 0.25);
    bump(c, "beverage", 0.25);
    bump(c, "cosmetics", 0.15);
  }

  const ranked = rank(c, 6);
  return ranked.length ? ranked : ["general"];
}

/**
 * Produce deep, sector-specific metrics for UI consumption.
 * Never returns an empty array for any provided sector.
 *
 * Bottom-up order:
 *   1) sector deep metrics
 *   2) product-specific metrics matched to detected products
 *   3) generic ops metrics as last resort
 */
export function metricsBySector(
  text: string,
  sectors: string[],
  productTags: string[],
): Record<string, string[]> {
  const bag = normalize(text).toLowerCase();

  // narrow product metrics to those actually present
  const productSet = new Set(productTags);

  const out: Record<string, string[]> = {};
  const sectorsEff = (sectors && sectors.length) ? sectors : ["general"];

  for (const sector of sectorsEff) {
    const key = sector.toLowerCase();
    const deep = SECTOR_DEEP_METRICS[key] || [];
    const prod: string[] = [];

    // Add product-specific metrics that are especially relevant to this sector.
    // (Light gating by sector keyword presence to keep lists tight.)
    const gateWord =
      key === "general" ? "" :
      key === "industrial" ? "industrial" :
      key;

    const gate = gateWord ? new RegExp(`\\b${gateWord}\\b`, "i") : null;
    const gateOk = !gate || gate.test(bag);

    if (gateOk) {
      for (const p of productSet) {
        const m = PRODUCT_METRICS[p];
        if (m && m.length) prod.push(...m);
      }
    }

    // Deduplicate while preserving order preference: deep -> prod -> generic
    const merged = uniq<string>([...deep, ...prod, ...GENERIC_OPS_METRICS]);

    // Keep it readable; UI can show more if needed.
    out[sector] = take(merged, 12);

    // Absolute guarantee: never empty.
    if (!out[sector].length) {
      out[sector] = take([...SECTOR_DEEP_METRICS.general, ...GENERIC_OPS_METRICS], 6);
    }
  }

  return out;
}

// Re-export a small list of known sectors/products (optional – can help UIs/tests)
export const KNOWN_SECTORS = Object.keys(SECTOR_CANON);
export const KNOWN_PRODUCTS = Object.keys(PRODUCT_CANON);