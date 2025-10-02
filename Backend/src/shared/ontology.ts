/* 
  Ontology (packaging) — industries, product lexicon, metric rules.
  Safe typing (no unions at call-sites): all pattern lists are RegExp[].
  Small helpers included so downstream code can stay simple.
*/

export type ID = string;

export interface IndustryRule {
  id: ID;
  label: string;
  patterns: RegExp[];          // text signals for this industry
}

export interface MetricRule {
  id: ID;
  label: string;
  industries?: ID[];           // if omitted, applies “general”
  patterns: RegExp[];          // text signals that support this metric
  weight?: number;             // optional influence hint
}

export type ProductLex = Record<string, RegExp[]>;

/* ------------------------------- utilities -------------------------------- */

function toRegExp(x: string | RegExp): RegExp {
  return x instanceof RegExp ? x : new RegExp(x, "i");
}
function toRegArray(x: string | RegExp | Array<string | RegExp>): RegExp[] {
  return Array.isArray(x) ? x.map(toRegExp) : [toRegExp(x)];
}

export function matchCount(text: string, pats: RegExp[] = []): number {
  const t = text || "";
  let n = 0;
  for (const re of pats) {
    try {
      if (re.test(t)) n++;
    } catch { /* ignore bad regex */ }
  }
  return n;
}

function rank<T extends { score: number }>(arr: T[], k = 8): T[] {
  return [...arr].sort((a, b) => b.score - a.score).slice(0, k);
}

/* --------------------------------- data ----------------------------------- */
/* Industries: lightweight signals. Expand/adjust over time. */

export const INDUSTRY_RULES: IndustryRule[] = [
  { id: "food",       label: "Food",       patterns: toRegArray([/food/i, /snack/i, /sauce/i, /retort/i, /hot[-\s]?fill/i, /fda/i]) },
  { id: "beverage",   label: "Beverage",   patterns: toRegArray([/beverage/i, /drink/i, /brew(ery|ing)/i, /distill(ery|ation)/i, /\bbottle(s)?\b/i]) },
  { id: "cosmetics",  label: "Cosmetics",  patterns: toRegArray([/cosmetic/i, /beauty/i, /skincare|skin care/i, /make-?up/i, /fragrance/i]) },
  { id: "supplements",label: "Supplements",patterns: toRegArray([/supplement/i, /vitamin/i, /nutraceutical/i]) },
  { id: "pharma",     label: "Pharma",     patterns: toRegArray([/pharma/i, /pharmaceutical/i, /\brx\b/i, /\botc\b/i, /gmp|cGMP/i]) },
  { id: "electronics",label: "Electronics",patterns: toRegArray([/electronics?/i, /device/i, /\bpcb\b/i, /\besd\b/i]) },
  { id: "apparel",    label: "Apparel",    patterns: toRegArray([/apparel/i, /garment/i, /fashion/i]) },
  { id: "industrial", label: "Industrial", patterns: toRegArray([/industrial/i, /manufactur(ing|er)/i, /b2b/i, /factory/i]) },
  { id: "automotive", label: "Automotive", patterns: toRegArray([/automotive/i, /\bauto\b/i, /aftermarket/i, /tier\s*[1-3]/i]) },
  { id: "cannabis",   label: "Cannabis",   patterns: toRegArray([/cannabis/i, /\bcbd\b/i, /hemp/i, /thc/i]) },
];

/* Products: normalized tags → signal regex list (use keys as canonical tags) */

export const PRODUCT_LEX: ProductLex = {
  boxes:       toRegArray([/\bbox(es)?\b/i, /carton(s)?/i, /folding carton/i, /rigid box/i]),
  labels:      toRegArray([/\blabel(s)?\b/i, /\bsticker(s)?\b/i]),
  tape:        toRegArray([/\btape\b/i, /packaging tape/i]),
  corrugate:   toRegArray([/corrugat(e|ed)/i, /corrugate/i]),
  mailers:     toRegArray([/\bmailer(s)?\b/i, /poly mailer/i]),
  pouches:     toRegArray([/\bpouch(es)?\b/i, /stand[-\s]?up pouch/i, /\bmylar\b/i]),
  film:        toRegArray([/\bfilm\b/i, /stretch( wrap)?/i, /shrink( wrap| film)?/i]),
  shrink:      toRegArray([/shrink( wrap| film)?/i]),
  pallets:     toRegArray([/\bpallet(s)?\b/i]),
  foam:        toRegArray([/\bfoam\b/i, /foam insert/i, /eva foam/i]),
  clamshells:  toRegArray([/clamshell(s)?/i, /blister/i]),
  bottles:     toRegArray([/\bbottle(s)?\b/i, /\bvial(s)?\b/i]),
  jars:        toRegArray([/\bjar(s)?\b/i, /\btin(s)?\b/i]),
  closures:    toRegArray([/\bclosure(s)?\b/i, /\bcap(s)?\b/i, /torque/i]),
  trays:       toRegArray([/\btray(s)?\b/i]),
};

/* Metrics: deeper, industry-aware buyer priorities. */

export const METRIC_RULES: MetricRule[] = [
  // Corrugate / boxes (general)
  { id: "ect_strength", label: "ECT / stack strength at target weight", patterns: toRegArray([/\bect\b/i, /edge[-\s]?crush/i, /stack (strength|testing)/i]), weight: 2 },
  { id: "board_grade",  label: "Board grade & burst/Mullen targets",     patterns: toRegArray([/mullen/i, /burst/i, /board grade/i]), weight: 1.6 },
  { id: "print_reg",    label: "Print registration & brand color accuracy", patterns: toRegArray([/print registration/i, /pantone|color match/i]), weight: 1.3 },
  { id: "ecom_fit",     label: "E-commerce fulfillment compatibility",    patterns: toRegArray([/e-?commerce/i, /fulfillment/i, /amazon/i]), weight: 1.0 },

  // Beverage specifics
  { id: "closure_torque", label: "Closure compatibility & torque", industries: ["beverage"], patterns: toRegArray([/torque/i, /cap( ping)?/i, /closure/i]) , weight: 2.0 },
  { id: "label_adh",      label: "Label application alignment & adhesion", industries: ["beverage"], patterns: toRegArray([/label applicat/i, /adhes(ion|ive)/i]) , weight: 1.6 },
  { id: "pack_stability", label: "Bottle/secondary pack stability in transit", industries: ["beverage"], patterns: toRegArray([/bottle pack/i, /case stability/i, /shrink bundle/i]) , weight: 1.4 },

  // Food specifics
  { id: "food_compliance", label: "Food-contact compliance (FDA/EC)", industries: ["food"], patterns: toRegArray([/fda/i, /food[-\s]?contact/i, /ec\s*1935\/2004/i]), weight: 2.0 },
  { id: "barrier_needs",   label: "Moisture / oxygen barrier needs", industries: ["food"], patterns: toRegArray([/oxygen barrier/i, /moisture barrier/i, /otr|wvtr/i]), weight: 1.7 },
  { id: "seal_integrity",  label: "Seal integrity under process (hot-fill/retort)", industries: ["food"], patterns: toRegArray([/retort/i, /hot[-\s]?fill/i, /seal integrity/i]), weight: 1.6 },

  // Cosmetics
  { id: "cos_color",    label: "Print finish & brand color match", industries: ["cosmetics"], patterns: toRegArray([/foil|emboss|varnish/i, /pantone|color match/i]) , weight: 1.6 },
  { id: "cos_decor",    label: "Decor registration (foil/emboss/deboss)", industries: ["cosmetics"], patterns: toRegArray([/emboss|deboss|foil/i]) , weight: 1.2 },

  // Electronics
  { id: "esd_safe",     label: "ESD-safe packaging compliance", industries: ["electronics"], patterns: toRegArray([/\besd\b/i, /ansi[-\s]?esd/i]) , weight: 2.0 },
  { id: "drop_protect", label: "Drop/edge-crush protection at DIM weight", industries: ["electronics"], patterns: toRegArray([/drop test/i, /edge[-\s]?crush/i, /dim weight/i]) , weight: 1.4 },

  // Pharma
  { id: "pharma_gmp",   label: "cGMP/FDA packaging compliance", industries: ["pharma"], patterns: toRegArray([/\bcgmp\b/i, /fda/i, /21\s*cfr/i]) , weight: 2.0 },
  { id: "pharma_serial",label: "Serialization / GS1 barcode placement", industries: ["pharma"], patterns: toRegArray([/serialization/i, /\bgs1\b/i, /barcode/i]) , weight: 1.2 },
  { id: "pharma_cr",    label: "Child-resistant closure certification", industries: ["pharma","cannabis"], patterns: toRegArray([/child[-\s]?resistant/i, /\bcrc?\b/i]) , weight: 1.4 },

  // General (useful defaults when nothing deep fires)
  { id: "damage_reduction", label: "Damage reduction targets in transit", patterns: toRegArray([/damage reduction/i, /transit damage/i, /supply chain damage/i]), weight: 1.2 },
  { id: "automation_uptime", label: "Automation line uptime impact", patterns: toRegArray([/line (uptime|stoppage|downtime)/i, /automation/i]), weight: 1.1 },
  { id: "sustainability", label: "Sustainability targets (PCR %, recyclability)", patterns: toRegArray([/pcr/i, /recyclab(le|ility)/i, /post[-\s]?consumer/i]), weight: 1.0 },
];

/* ------------------------------- detectors -------------------------------- */

export function detectIndustries(text: string, top = 3): Array<{ id: ID; label: string; score: number }> {
  const t = text || "";
  const scored = INDUSTRY_RULES.map(r => ({ id: r.id, label: r.label, score: matchCount(t, r.patterns) }));
  return rank(scored, top).filter(x => x.score > 0);
}

export function detectProducts(text: string, top = 12): string[] {
  const t = text || "";
  const scored = Object.entries(PRODUCT_LEX).map(([tag, res]) => ({ tag, score: matchCount(t, res) }));
  return rank(scored, top).filter(x => x.score > 0).map(x => x.tag);
}

export function detectMetrics(text: string, industries: ID[], top = 6): string[] {
  const t = text || "";
  const ids = new Set(industries);
  const scored = METRIC_RULES
    .filter(m => !m.industries || m.industries.some(id => ids.has(id)))
    .map(m => {
      const base = matchCount(t, m.patterns);
      const w = Number(m.weight || 1);
      return { id: m.id, score: base * w, label: m.label };
    });
  const primary = rank(scored, top).filter(x => x.score > 0);
  if (primary.length) return primary.map(x => x.id);
  // fallback: general defaults if nothing triggered
  const general = METRIC_RULES.filter(m => !m.industries).slice(0, top);
  return general.map(m => m.id);
}

/* ---------------------------- presentation helpers ------------------------ */

export function composeOneLiner(host: string, products: string[], sectors: string[]): string {
  const h = (host || "").replace(/^www\./, "");
  const p = products.slice(0, 3);
  const s = sectors.slice(0, 3);
  const moreP = products.length > 3 ? ", etc." : "";
  const moreS = sectors.length > 3 ? " & others" : "";
  const prodText = p.length ? ` — ${p.join(", ")}${moreP}` : "";
  const sectorText = s.length ? ` for ${s.join(" & ")} brands${moreS}` : "";
  return `${h} supplies packaging${prodText}${sectorText}.`;
}

/* Export rule lookup for UIs (labels by id) */
export const METRIC_LABEL_BY_ID: Record<string, string> =
  Object.fromEntries(METRIC_RULES.map(m => [m.id, m.label]));
export const INDUSTRY_LABEL_BY_ID: Record<string, string> =
  Object.fromEntries(INDUSTRY_RULES.map(r => [r.id, r.label]));