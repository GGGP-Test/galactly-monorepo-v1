// Lightweight packaging ontology + extractors (no external deps)
//
// What this module does
// 1) Normalizes and detects product tags and sector hints from raw text/meta
// 2) Extracts deep "buyer metrics" per sector using regex patterns
//    - detailed matches first (bottom-up), then sector-general, then general fallback
// 3) Always returns something (no empty sectors)
//
// Exports
// - productsFrom(text, keywords?) -> string[]            (up to 12, ordered by score)
// - sectorsFrom(text, keywords?) -> string[]             (up to 8, ordered by score)
// - metricsBySector(text, sectors?, products?) -> Record<string,string[]>
//
// Notes
// - Keep in sync with spider/classifier defaults, but this file stands alone.
// - Tune by adding synonyms/patterns; everything is deterministic & cheap.

export type SectorKey =
  | "food" | "beverage" | "cosmetics" | "supplements"
  | "electronics" | "pharma" | "pet" | "automotive"
  | "industrial" | "logistics" | "warehouse" | "home"
  | "cannabis" | "general";

export type ProductKey =
  | "boxes" | "labels" | "cartons" | "pouches" | "bottles" | "jars"
  | "tape" | "corrugate" | "mailers" | "clamshells" | "foam" | "pallets"
  | "mailer_bags" | "shrink" | "film" | "closures" | "rigid";

type Lex = Record<string, string[]>;

const PRODUCT_LEX: Lex = {
  boxes: ["box","boxes","mailing box","mailer box","rigid box","setup box","folding carton box"],
  labels: ["label","labels","sticker","stickers","ps label","pressure sensitive label"],
  cartons: ["carton","cartons","folding carton"],
  pouches: ["pouch","pouches","stand up pouch","stand-up pouch","mylar"],
  bottles: ["bottle","bottles","vial","vials"],
  jars: ["jar","jars","tin","tins"],
  tape: ["tape","packaging tape"],
  corrugate: ["corrugate","corrugated","corrugated box","shipper"],
  mailers: ["mailer","mailers","poly mailer"],
  clamshells: ["clamshell","clamshells","blister"],
  foam: ["foam","foam insert","eva foam"],
  pallets: ["pallet","pallets","palletizing"],
  mailer_bags: ["bag","bags","polybag","poly bag"],
  shrink: ["shrink","shrink wrap","shrink film","shrink sleeve"],
  film: ["film","stretch","stretch wrap","stretch film","laminate","laminated film"],
  closures: ["closure","closures","cap","caps","lug","crown","ct cap","child-resistant cap"],
  rigid: ["rigid","rigid container","rigid packaging"]
};

const SECTOR_LEX: Lex = {
  food: ["food","grocery","snack","sauce","salsa","candy","baked","bakery"],
  beverage: ["beverage","drink","juice","soda","coffee","tea","brewery","beer","wine","distillery","cpg beverage"],
  cosmetics: ["cosmetic","cosmetics","beauty","skincare","skin care","haircare","makeup","fragrance"],
  supplements: ["supplement","nutraceutical","vitamin","sports nutrition"],
  electronics: ["electronics","devices","gadgets","semiconductor","pcb","hardware device"],
  apparel: ["apparel","fashion","clothing","garment"], // alias; maps to industrial/home if needed
  pharma: ["pharma","pharmaceutical","medical","medication","rx","otc"],
  pet: ["pet","pets","petcare","pet care"],
  automotive: ["automotive","auto","aftermarket","auto parts"],
  home: ["home goods","home & garden","furniture","decor","household"],
  industrial: ["industrial","manufacturing","b2b","factory","machining","fabrication"],
  logistics: ["logistics","3pl","third party logistics","fulfillment","distribution","dc"],
  warehouse: ["warehouse","warehousing","distribution center","dc","pallet load","pallets"],
  cannabis: ["cannabis","cbd","hemp"]
};

// -------------- helpers --------------

function esc(s: string){ return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }

function scoreLex(text: string, keywords: string[] | undefined, lex: Lex): Record<string, number> {
  const t = text.toLowerCase();
  const kw = (keywords || []).join(" ").toLowerCase();
  const scores: Record<string, number> = {};
  for (const [key, syns] of Object.entries(lex)) {
    let n = 0;
    for (const s of syns) {
      const re = new RegExp(`\\b${esc(s.toLowerCase())}\\b`, "g");
      n += (t.match(re)?.length || 0) + (kw.match(re)?.length || 0);
    }
    if (n > 0) scores[key] = n;
  }
  return scores;
}

function topKeys(scores: Record<string, number>, max: number): string[] {
  return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0,max).map(([k])=>k);
}

function uniqKeepOrder<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = String(x).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(x);
  }
  return out;
}

// -------------- public product/sector detection --------------

export function productsFrom(text: string, keywords?: string[]): string[] {
  const scores = scoreLex(text, keywords, PRODUCT_LEX);
  const ordered = topKeys(scores, 12) as ProductKey[];
  return ordered;
}

export function sectorsFrom(text: string, keywords?: string[]): string[] {
  const scores = scoreLex(text, keywords, SECTOR_LEX);
  // Favor logistics/warehouse if strong film/stretch signals appear
  const bonus = /\b(stretch|stretch\s+film|shrink\s+wrap|pallet|palletizing)\b/i.test(text) ? 1 : 0;
  if (bonus) {
    scores["logistics"] = (scores["logistics"] || 0) + 1;
    scores["warehouse"] = (scores["warehouse"] || 0) + 1;
  }
  return topKeys(scores, 8) as SectorKey[];
}

// -------------- metric ontology --------------

type MetricDef = { label: string; pats?: RegExp[]; weight?: number };

// Detailed, sector-specific first; keep concise labels (UI renders them directly)
const METRIC_PATTERNS: Record<SectorKey, MetricDef[]> = {
  beverage: [
    { label: "Closure compatibility & torque", pats: [/closure|cap|torque|crown|finish/i] },
    { label: "Label application alignment & adhesion", pats: [/label.+(apply|adhesion|registration)/i] },
    { label: "Bottle/secondary pack stability in transit", pats: [/bottle|case.+stability|shippers?/i] },
    { label: "Cold-chain / condensation resistance", pats: [/cold(-|\s)?chain|condensation|wet.+strength/i] },
    { label: "Lot traceability & COA", pats: [/traceability|coa|certificate of analysis/i] }
  ],
  food: [
    { label: "Food-contact compliance (FDA/EC)", pats: /(fda|usda|ec)\W?.{0,10}(compliance|contact)/i },
    { label: "Moisture / oxygen barrier needs", pats: /moisture|oxygen|otr|wvtr|barrier/i },
    { label: "Seal integrity under process (hot-fill/retort)", pats: /(hot[-\s]?fill|retort|seal integrity)/i },
    { label: "Case-packing line uptime impact", pats: /(case[-\s]?pack|line).{0,20}(uptime|downtime)/i }
  ],
  cosmetics: [
    { label: "Print finish & brand color match", pats: /pantone|brand color|gloss|matte|soft touch/i },
    { label: "Decor registration (foil/emboss/deboss)", pats: /(foil|emboss|deboss).{0,20}(register|registration|alignment)/i },
    { label: "Label adhesion on varnished surfaces", pats: /label.+(varnish|adhesion)/i },
    { label: "Tamper-evidence features", pats: /tamper/i }
  ],
  electronics: [
    { label: "Drop/edge-crush protection at DIM weight", pats: /(drop test|edge crush|ect|dim weight)/i },
    { label: "ESD-safe packaging compliance", pats: /esd|electrostatic/i },
    { label: "Foam insert precision & fit", pats: /(foam insert|die cut foam|precision fit)/i }
  ],
  pharma: [
    { label: "cGMP/FDA packaging compliance", pats: /(cGmp|gmp|fda).{0,20}(packaging|compl)/i },
    { label: "Serialization / GS1 barcode placement", pats: /gs1|serialization|serialized/i },
    { label: "Tamper-evident & child-resistant certification", pats: /child[-\s]?resistant|crcert|astm|16 cfr/i }
  ],
  cannabis: [
    { label: "Child-resistant certification", pats: /child[-\s]?resistant|cr\s?cert/i },
    { label: "State regulatory label compliance", pats: /warning|prop 65|state required label/i },
    { label: "Odor/light barrier performance", pats: /(odor|light).{0,10}barrier/i }
  ],
  automotive: [
    { label: "Component protection & abrasion resistance", pats: /(abrasion|scuff|scratch).{0,20}(resist)/i },
    { label: "Returnable/dunnage compatibility", pats: /(returnable|dunnage|tote)/i }
  ],
  pet: [
    { label: "Puncture resistance for kibble/chews", pats: /(puncture|tear).{0,10}(resist)/i },
    { label: "Odor/grease barrier", pats: /(odor|grease).{0,10}barrier/i }
  ],
  home: [
    { label: "Retail scuff/scratch resistance", pats: /(retail|shelf).{0,20}(scuff|scratch)/i },
    { label: "Print durability (rub/bleed)", pats: /(rub|bleed|ink).{0,15}(resist|durab)/i }
  ],
  industrial: [
    { label: "Outer carton strength at target cost", pats: /(ect|mullen|burst|board grade)/i },
    { label: "Pallet pattern compatibility", pats: /(pallet pattern|ti.?hi|ti-hi)/i }
  ],
  warehouse: [
    { label: "Load containment force at target pre-stretch", pats: /(containment force|pre[-\s]?stretch|force meter)/i },
    { label: "Irregular load stability (non-cubed)", pats: /(irregular|non[-\s]?cubed|odd[-\s]?shape).{0,20}(load|pallet)/i },
    { label: "Corner/edge tear risk mitigation", pats: /(corner|edge).{0,15}(tear|puncture)/i },
    { label: "Cling/slip vs film-to-film contact", pats: /(cling|slip).{0,20}(film|wrap)/i }
  ],
  logistics: [
    { label: "E-commerce / ISTA transit readiness", pats: /(ista|e-?commerce|parcel).{0,20}(test|transit)/i },
    { label: "Damage reduction targets in transit", pats: /(damage rate|in-transit damage|claims)/i },
    { label: "Automation line uptime impact", pats: /(automation|auto wrap|case packer).{0,20}(uptime|downtime)/i }
  ],
  // sectors not explicitly listed above get covered by general fallbacks
  general: [
    { label: "Damage reduction targets in transit" },
    { label: "Automation line uptime impact" },
    { label: "Sustainability targets (PCR %, recyclability)" },
    { label: "Unit cost at target MOQ" }
  ],
  supplements: [
    { label: "Barrier & freshness (moisture/oxygen)", pats: /moisture|oxygen|barrier|desiccant/i },
    { label: "Tamper-evident seal integrity", pats: /induction seal|tamper/i }
  ]
};

// Product-driven metric adders (e.g., if film/shrink detected)
const PRODUCT_METRIC_HINTS: Partial<Record<ProductKey, MetricDef[]>> = {
  film: [
    { label: "Load containment force at target pre-stretch" },
    { label: "Puncture/tear resistance vs edges" }
  ],
  shrink: [
    { label: "Shrink curve & optics (haze/clarity)" },
    { label: "Perforation & venting for trapped air" }
  ],
  corrugate: [
    { label: "ECT / stack strength at target weight" },
    { label: "Print registration & color accuracy" }
  ],
  labels: [
    { label: "Adhesive selection vs substrate" },
    { label: "Application speed & registration" }
  ],
  closures: [
    { label: "Torque window & closure compatibility" }
  ]
};

// -------------- extraction engine --------------

function matchMetrics(text: string, defs: MetricDef[]): string[] {
  const t = text || "";
  const hits: Array<{ label: string; w: number }> = [];
  for (const d of defs) {
    const any = !d.pats || d.pats.length === 0
      ? false
      : d.pats.some(re => re.test(t));
    const w = (any ? (d.weight ?? 2) : (d.pats ? 0 : 1)); // explicit matches outrank implied
    if (w > 0) hits.push({ label: d.label, w });
  }
  // sort by weight desc, keep unique
  const ordered = hits.sort((a,b)=>b.w-a.w).map(h=>h.label);
  return uniqKeepOrder(ordered);
}

function sectorFallback(sector: SectorKey): string[] {
  if (sector !== "general" && METRIC_PATTERNS[sector]) {
    // keep the first three generic from that sector if present
    const names = METRIC_PATTERNS[sector].map(d=>d.label);
    if (names.length) return uniqKeepOrder(names).slice(0,3);
  }
  return METRIC_PATTERNS.general.map(d=>d.label).slice(0,3);
}

export function metricsBySector(
  text: string,
  sectorHints?: string[] | null,
  productTags?: string[] | null
): Record<string, string[]> {
  const sectors: SectorKey[] = (sectorHints?.length ? sectorHints : ["general"])
    .map(s => (s as SectorKey))
    .filter(Boolean);

  const prods = (productTags || []) as ProductKey[];

  const out: Record<string, string[]> = {};

  for (const s of sectors) {
    const defs = METRIC_PATTERNS[s as SectorKey] || [];
    let list = matchMetrics(text, defs);

    // product-informed additions for this sector
    for (const p of prods) {
      const adds = PRODUCT_METRIC_HINTS[p as ProductKey];
      if (adds && adds.length) {
        list = uniqKeepOrder([...list, ...adds.map(a=>a.label)]);
      }
    }

    // if nothing matched, use sector fallback then general
    if (!list.length) list = sectorFallback(s);

    // Always ensure at least 3 per sector (mix in general fallbacks)
    if (list.length < 3) {
      const gen = METRIC_PATTERNS.general.map(d=>d.label);
      list = uniqKeepOrder([...list, ...gen]).slice(0, 6);
    }

    out[s] = list.slice(0, 8); // reasonable cap per sector
  }

  // If caller only asked for general or we ended up empty, ensure a general key
  if (!Object.keys(out).length) {
    out.general = METRIC_PATTERNS.general.map(d=>d.label).slice(0,4);
  }

  return out;
}

// Convenience exports for other modules / tests
export const ALL_PRODUCTS = Object.freeze(Object.keys(PRODUCT_LEX));
export const ALL_SECTORS  = Object.freeze(Object.keys(SECTOR_LEX));