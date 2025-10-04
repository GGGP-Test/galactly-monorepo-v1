// src/shared/trc.ts
//
// ARTEMIS-B v1 — production scorer + shared "hot metrics by sector".
// Deterministic, dependency-free. Used by routes/leads.ts and classify.ts.
//
// Exports (stable):
//   HOT_MIN, WARM_MIN
//   classifyScore(score): "HOT" | "WARM" | "COOL"
//   scoreRow(row, prefs, city?): { score:number, reasons:string[] }
//   HOT_METRICS_BY_SECTOR, getHotMetricsBySector(), hotMetricsForSectors()
//
// Env knobs (all optional; numbers):
//   HOT_MIN=80
//   WARM_MIN=55
//   SIZE_SCALE=10
//   LOCALITY_MAX_BONUS=15
//   TAG_HIT_BONUS=5
//   TAG_MAX_BONUS=20
//   ADS_ACTIVITY_WEIGHT=35
//   SCORER_WEIGHTS_JSON='{"ADS_ACTIVITY_WEIGHT":40,"SIZE_SCALE":12,...}'
//
// Notes:
// - If SCORER_WEIGHTS_JSON is present, its values override individual env vars.
// - Ads signal is pulled from ./ads-store (0..1) and mapped to points.

 /* eslint-disable @typescript-eslint/no-explicit-any */

import { getSignal as getAdsSignal } from "./ads-store";

/* ----------------------------- env helpers ----------------------------- */

function envNum(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : dflt;
}
function parseWeightsJSON(): Partial<Record<string, number>> {
  try {
    const raw = process.env.SCORER_WEIGHTS_JSON;
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

const JW = parseWeightsJSON();

/* ------------------------------ thresholds ----------------------------- */

export const HOT_MIN  = (JW.HOT_MIN  ?? envNum("HOT_MIN",  80)) as number;
export const WARM_MIN = (JW.WARM_MIN ?? envNum("WARM_MIN", 55)) as number;

export type Band = "HOT" | "WARM" | "COOL";
export function classifyScore(score: number): Band {
  if (score >= HOT_MIN) return "HOT";
  if (score >= WARM_MIN) return "WARM";
  return "COOL";
}

/* ------------------------------- utils -------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase().trim();

function clampNum(n: any, lo: number, hi: number, fb = 0): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fb;
  return Math.max(lo, Math.min(hi, x));
}

function setLower(arr: any): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(arr)) for (const v of arr) { const s = lc(v); if (s) out.add(s); }
  return out;
}
function listLower(arr: any): string[] { return Array.from(setLower(arr)); }

function firstLower(arr: any): string | undefined {
  if (!Array.isArray(arr) || !arr.length) return;
  const s = lc(arr[0]);
  return s || undefined;
}

function sizeBucket(val: any): "micro" | "small" | "mid" | "large" | undefined {
  const s = lc(val);
  return (s === "micro" || s === "small" || s === "mid" || s === "large") ? s : undefined;
}

function intersectCount(a: Set<string>, b: Set<string>): number {
  let n = 0; a.forEach(v => { if (b.has(v)) n++; }); return n;
}

function cityBoostPoints(anchor?: string, candidate?: string, maxBonus = 15): number {
  const A = lc(anchor), B = lc(candidate);
  if (!A || !B) return 0;
  if (A === B) return maxBonus;                    // exact city match
  if (B.includes(A) || A.includes(B)) return Math.floor(maxBonus * 0.66);
  return 0;
}

function normHost(input?: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/* ------------------------ hot metrics by sector ------------------------ */

export const HOT_METRICS_BY_SECTOR: Record<string, string[]> = {
  general: [
    "Line automation / fulfillment",
    "Fast turnaround (≤ 2 weeks)",
    "Lowest unit cost",
  ],
  food: [
    "FSMA / HACCP-ready packaging",
    "Shelf-life / barrier performance",
    "Unit cost at volume",
  ],
  beverage: [
    "High-speed line compatibility",
    "Pallet efficiency / cube",
    "Shrink/stretch film performance",
  ],
  cosmetics: [
    "Brand presentation / unboxing",
    "Regulatory/INCI labeling readiness",
    "MOQ-friendly lead times",
  ],
  pharma: [
    "QA/Regulatory compliance (cGMP)",
    "Tamper-evident integrity",
    "Lot/traceability labeling",
  ],
  cannabis: [
    "Compliance (CR, labeling)",
    "Odor/oxygen barrier",
    "Small-batch MOQs",
  ],
  industrial: [
    "Freight/pallet protection",
    "Throughput on automated lines",
    "Material cost per unit",
  ],
  logistics: [
    "Damage reduction in transit",
    "Throughput & pack time",
    "Box/void-fill optimization",
  ],
  electronics: [
    "ESD-safe materials",
    "Fragile-protection systems",
    "Kitting efficiency",
  ],
  apparel: [
    "Mailer/kitting throughput",
    "Returns-friendly packaging",
    "Branding at cost",
  ],
};

export function getHotMetricsBySector(): Record<string, string[]> {
  return HOT_METRICS_BY_SECTOR;
}

export function hotMetricsForSectors(sectors?: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const list = Array.isArray(sectors) && sectors.length ? sectors : ["general"];
  for (const s of list) {
    const k = lc(s);
    out[k] = (HOT_METRICS_BY_SECTOR[k] || HOT_METRICS_BY_SECTOR.general).slice(0, 3);
  }
  return out;
}

/* ------------------------------- weights ------------------------------- */

const SIZE_SCALE          = (JW.SIZE_SCALE          ?? envNum("SIZE_SCALE", 10)) as number;            // maps sizeWeight to points
const LOCALITY_MAX_BONUS  = (JW.LOCALITY_MAX_BONUS  ?? envNum("LOCALITY_MAX_BONUS", 15)) as number;    // max locality bump
const TAG_HIT_BONUS       = (JW.TAG_HIT_BONUS       ?? envNum("TAG_HIT_BONUS", 5)) as number;          // per tag overlap
const TAG_MAX_BONUS       = (JW.TAG_MAX_BONUS       ?? envNum("TAG_MAX_BONUS", 20)) as number;         // cap for tag overlap
const ADS_ACTIVITY_WEIGHT = (JW.ADS_ACTIVITY_WEIGHT ?? envNum("ADS_ACTIVITY_WEIGHT", 35)) as number;   // ads 0..1 -> points

/* ------------------------------- scorer -------------------------------- */

/**
 * ARTEMIS-B v1 dimensions we score (cheap, deterministic):
 * 1) Tier (A/B/C)
 * 2) City proximity (query or persona)
 * 3) Tag overlap (product/likeTags vs row.tags/segments)
 * 4) Sector fit (persona.sectorHints vs row.sector)
 * 5) Size fit — revenue (when row.revenueM present)
 * 6) Size fit — employees (when row.employees present)
 * 7) E-commerce preference match
 * 8) Wholesale/distributor preference match
 * 9) Product focus match (materials)
 * 10) Certifications needed (boost/soft nudge)
 * 11) Keywords add/avoid (light text tokens)
 * 12) Ads activity signal (from ads-store)
 */
export function scoreRow(row: any, prefs: any, panelCity?: string): { score: number; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  // ---- 1) Tier
  const tier = (row?.tier === "A" || row?.tier === "B" || row?.tier === "C")
    ? row.tier
    : (firstLower(row?.tiers) as any)?.toUpperCase();
  if (tier === "A") { score += 12; reasons.push("tier:A"); }
  else if (tier === "B") { score += 6; reasons.push("tier:B"); }
  else { reasons.push("tier:C"); }

  // ---- 2) City proximity (env-tunable max)
  const wantedCity = lc(panelCity) || lc(prefs?.targeting?.city) || (prefs?.targeting?.cities || [])[0];
  const cAdd = cityBoostPoints(wantedCity, row?.city, LOCALITY_MAX_BONUS);
  if (cAdd) { score += cAdd; reasons.push(`local+${cAdd}`); }

  // ---- 3) Tag overlap
  const wantTags = setLower([
    ...(prefs?.productTags || []),
    ...(prefs?.likeTags || []),
    ...((prefs?.targeting?.tags as string[]) || []),
  ]);
  const rowTags = setLower([...(row?.tags || []), ...(row?.segments || [])]);
  const tagHits = wantTags.size && rowTags.size ? intersectCount(wantTags, rowTags) : 0;
  if (tagHits) {
    const add = Math.min(TAG_MAX_BONUS, tagHits * TAG_HIT_BONUS);
    score += add;
    reasons.push(`tags+${tagHits}`);
  }

  // ---- 4) Sector fit
  const sector = lc(row?.sector);
  const wantSectors = setLower(prefs?.sectorHints || []);
  if (sector && wantSectors.size && wantSectors.has(sector)) { score += 6; reasons.push(`sector:${sector}`); }

  // ---- 5) Size fit — revenue window (if provided)
  const minR = Number(prefs?.targeting?.revenueMinM ?? NaN);
  const maxR = Number(prefs?.targeting?.revenueMaxM ?? NaN);
  if (Number.isFinite(row?.revenueM) && (Number.isFinite(minR) || Number.isFinite(maxR))) {
    const r = Number(row.revenueM);
    if (Number.isFinite(minR) && r >= minR) { score += 3; reasons.push(`rev>=${minR}M`); }
    if (Number.isFinite(maxR) && r <= maxR) { score += 3; reasons.push(`rev<=${maxR}M`); }
  }

  // ---- 6) Size fit — employees proximity (if provided)
  const wantEmp = Number(prefs?.targeting?.employees ?? NaN);
  if (Number.isFinite(row?.employees) && Number.isFinite(wantEmp) && wantEmp > 0) {
    const diff = Math.abs(Number(row.employees) - wantEmp);
    if (diff <= 50) { score += 4; reasons.push("emp≈target"); }
    else if (diff <= 200) { score += 2; reasons.push("emp~target"); }
  }

  // ---- 7–8) Preference flags via cheap hints
  const hasEcom = rowTags.has("ecom") || rowTags.has("shopify") || (lc(row?.platform) || "").includes("shopify");
  const hasWholesale = rowTags.has("wholesale") || rowTags.has("distributor") || rowTags.has("b2b");
  if (prefs?.general?.ecom && hasEcom) { score += 3; reasons.push("ecom"); }
  if (prefs?.general?.wholesale && hasWholesale) { score += 3; reasons.push("wholesale"); }

  // ---- 9) Materials allow/block
  const allowMat = setLower(prefs?.materialsAllow || []);
  const blockMat = setLower(prefs?.materialsBlock || []);
  if (allowMat.size || blockMat.size) {
    const rowMats = setLower([...(row?.materials || []), ...rowTags]);
    const ok = intersectCount(rowMats, allowMat);
    const bad = intersectCount(rowMats, blockMat);
    if (ok > 0)  { score += Math.min(10, 4 * ok); reasons.push(`material+${ok}`); }
    if (bad > 0) { score -= Math.min(12, 6 * bad); reasons.push(`material-${bad}`); }
  }

  // ---- 10) Certifications required
  const needCerts = setLower(prefs?.certsRequired || []);
  if (needCerts.size) {
    const rowCerts = setLower([...(row?.certs || []), ...rowTags]);
    const cHits = intersectCount(rowCerts, needCerts);
    if (cHits > 0) { score += Math.min(10, 4 * cHits); reasons.push(`cert+${cHits}`); }
    else { score -= 3; reasons.push("missing-certs"); }
  }

  // ---- 11) Keywords add/avoid (light tokens)
  const kwAdd = setLower(prefs?.keywordsAdd || []);
  const kwAvoid = setLower(prefs?.keywordsAvoid || []);
  if (kwAdd.size || kwAvoid.size) {
    const blob = new Set<string>([
      ...listLower(row?.tags),
      ...listLower(row?.segments),
      ...listLower(String(row?.why || "").split(/[^\w]+/)),
      ...listLower(String(row?.name || "").split(/[^\w]+/)),
    ]);
    const addHits = intersectCount(blob, kwAdd);
    const avoidHits = intersectCount(blob, kwAvoid);
    if (addHits > 0)   { score += Math.min(8, 2 * addHits); reasons.push(`kw+${addHits}`); }
    if (avoidHits > 0) { score -= Math.min(9, 3 * avoidHits); reasons.push(`kw-${avoidHits}`); }
  }

  // ---- (Optional) legacy size bucket (if present) mapped via SIZE_SCALE
  const rowSize = sizeBucket(row?.size);
  if (rowSize) {
    const sw = prefs?.sizeWeight || {};
    const w =
      rowSize === "micro" ? clampNum(sw.micro, -3, 3, 1.2) :
      rowSize === "small" ? clampNum(sw.small, -3, 3, 1.0) :
      rowSize === "mid"   ? clampNum(sw.mid,   -3, 3, 0.6) :
      rowSize === "large" ? clampNum(sw.large, -3, 3, -1.2) : 0;
    if (w) {
      const add = Math.max(-SIZE_SCALE, Math.min(SIZE_SCALE, Math.round(w * (SIZE_SCALE / 2))));
      score += add;
      reasons.push(`size:${rowSize}@${w.toFixed(2)}(+${add})`);
    }
  }

  // ---- 12) Ads activity (0..1 from ads-store) -> points
  try {
    const host = normHost(row?.host);
    if (host) {
      const sig = getAdsSignal(host); // 0..1
      if (typeof sig === "number" && sig > 0) {
        const add = Math.round(sig * ADS_ACTIVITY_WEIGHT);
        score += add;
        reasons.push(`ads:${sig.toFixed(2)}(+${add})`);
      }
    }
  } catch { /* ignore */ }

  // ---- finalize
  score = Math.max(0, Math.min(100, score));
  if (reasons.length > 12) reasons.length = 12;
  return { score, reasons };
}

export default {
  HOT_MIN,
  WARM_MIN,
  classifyScore,
  scoreRow,
  HOT_METRICS_BY_SECTOR,
  getHotMetricsBySector,
  hotMetricsForSectors,
};