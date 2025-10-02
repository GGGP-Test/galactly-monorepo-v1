// src/shared/trc.ts
//
// Lightweight lead scoring + band thresholds used by routes/leads.ts.
// Deterministic, dependency-free, and now aware of persona overlays:
//   - titlesPreferred: string[]
//   - materialsAllow/materialsBlock: string[]
//   - certsRequired: string[]
//   - keywordsAdd/keywordsAvoid: string[]
//
// Exported surface (unchanged):
//   - HOT_MIN, WARM_MIN
//   - classifyScore(score) => "HOT" | "WARM" | "COOL"
//   - scoreRow(row, prefs, city?) => { score:number, reasons:string[] }
//
// Row (buyer candidate) is loose: { host, tier/tiers?, size?, tags?, segments?,
//                                   city?, cityTags?, materials?, certs?, roles?/contacts?/bestTitles? }
// Prefs is EffectivePrefs from shared/prefs plus optional overlay fields above.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const HOT_MIN = 80;
export const WARM_MIN = 55;

export function classifyScore(score: number): "HOT" | "WARM" | "COOL" {
  if (score >= HOT_MIN) return "HOT";
  if (score >= WARM_MIN) return "WARM";
  return "COOL";
}

/* --------------------------------- utils ---------------------------------- */

function clamp(n: any, lo: number, hi: number, fb: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fb;
  return Math.max(lo, Math.min(hi, x));
}

function lowerSet(arr: any): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      const s = String(v ?? "").toLowerCase().trim();
      if (s) out.add(s);
    }
  }
  return out;
}

function lowerList(arr: any): string[] {
  return Array.from(lowerSet(arr));
}

function firstLower(arr: any): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  const s = String(arr[0] ?? "").toLowerCase().trim();
  return s || undefined;
}

function sizeBucket(val: any): "micro" | "small" | "mid" | "large" | undefined {
  const s = String(val ?? "").toLowerCase().trim();
  if (s === "micro" || s === "small" || s === "mid" || s === "large") return s;
  return undefined;
}

function cityMatchBoost(panelCity?: string, rowCity?: string, rowCityTags?: string[]): number {
  if (!panelCity) return 0;
  const a = panelCity.toLowerCase().trim();
  if (!a) return 0;
  if (rowCity && rowCity.toLowerCase().trim() === a) return 8;            // exact hit
  if (Array.isArray(rowCityTags)) {
    for (const c of rowCityTags) {
      if (String(c || "").toLowerCase().trim() === a) return 6;           // tag hit
    }
  }
  // small fuzzy: substring or prefix like "los angeles" vs "los angeles county"
  if (rowCity && (rowCity.toLowerCase().includes(a) || a.includes(rowCity.toLowerCase()))) return 4;
  return 0;
}

function intersectCountSet(a: Set<string>, b: Set<string>): number {
  let n = 0;
  a.forEach(v => { if (b.has(v)) n++; });
  return n;
}

function anyIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
}

/* --------------------------------- scorer --------------------------------- */

/**
 * Score a catalog row with respect to effective prefs and optional city focus.
 * Produces a 0..100 score and short "reasons" suitable for UI chips.
 */
export function scoreRow(row: any, prefs: any, panelCity?: string): { score: number; reasons: string[] } {
  // Base score
  let score = 50;
  const reasons: string[] = [];

  // --- Tier priority (A>B>C) --------------------------------------------
  const tier = (row?.tier === "A" || row?.tier === "B" || row?.tier === "C")
    ? row.tier
    : (firstLower(row?.tiers) as "a" | "b" | "c" | undefined)?.toUpperCase();

  if (tier === "A") { score += 8; reasons.push("tier:A"); }
  else if (tier === "B") { score += 3; reasons.push("tier:B"); }
  else if (tier === "C") { score += 0; reasons.push("tier:C"); }

  // --- Size fit (micro/small/mid/large) --------------------------------
  const rowSize = sizeBucket(row?.size);
  const sw = prefs?.sizeWeight || {};
  const wMicro = clamp(sw.micro, -3, 3, 1.2);
  const wSmall = clamp(sw.small, -3, 3, 1.0);
  const wMid   = clamp(sw.mid,   -3, 3, 0.6);
  const wLarge = clamp(sw.large, -3, 3, -1.2);

  const sizeW = rowSize === "micro" ? wMicro
              : rowSize === "small" ? wSmall
              : rowSize === "mid"   ? wMid
              : rowSize === "large" ? wLarge
              : 0;

  if (rowSize) {
    score += sizeW * 4; // weight -> up to about ±12
    reasons.push(`size:${rowSize}@${sizeW.toFixed(2)}`);
  }

  // --- Category allow/block (tags & segments) ---------------------------
  const allow = lowerSet(prefs?.categoriesAllow || []);
  const block = lowerSet(prefs?.categoriesBlock || []);
  const rowTags = lowerSet(row?.tags || []);
  const rowSegs = lowerSet(row?.segments || []);
  const rowCats = new Set<string>([...rowTags, ...rowSegs]);

  const hitsAllow = intersectCountSet(rowCats, allow);
  const hitsBlock = intersectCountSet(rowCats, block);

  if (hitsAllow > 0) { score += Math.min(10, 4 * hitsAllow); reasons.push(`allow+${hitsAllow}`); }
  if (hitsBlock > 0) { score -= Math.min(12, 6 * hitsBlock); reasons.push(`block-${hitsBlock}`); }

  // --- Signal weights (panel “sliders”) --------------------------------
  const sig = prefs?.signalWeight || {};
  const wLocal     = clamp(sig.local,     -3, 3, 1.6);
  const wEcomm     = clamp(sig.ecommerce, -1, 1, 0.25);
  const wRetail    = clamp(sig.retail,    -1, 1, 0.2);
  const wWholesale = clamp(sig.wholesale, -1, 1, 0.1);

  // local signal: city proximity
  const localBoost = cityMatchBoost(prefs?.city || panelCity, row?.city, row?.cityTags);
  if (localBoost) { score += localBoost * (1 + 0.2 * wLocal); reasons.push(`local+${localBoost | 0}`); }

  // very light generic boosts (if row has hints)
  if (rowTags.size > 0)  { score += 2 * wRetail;    reasons.push("retail-ish"); }
  if (rowSegs.size > 0)  { score += 2 * wWholesale; reasons.push("wholesale-ish"); }
  if ((row?.platform || "").includes("shopify")) { score += 2 * wEcomm; reasons.push("ecomm"); }

  // --- Persona overlays (new) -------------------------------------------
  // Titles preferred (match against any row roles/contacts/bestTitles)
  const prefTitles = lowerSet(prefs?.titlesPreferred || []);
  if (prefTitles.size) {
    const rowTitles = new Set<string>([
      ...lowerList(row?.roles),
      ...lowerList(row?.contacts),
      ...lowerList(row?.bestTitles),
    ]);
    const tHits = intersectCountSet(prefTitles, rowTitles);
    if (tHits > 0) {
      score += Math.min(9, 3 * tHits);
      reasons.push(`title+${tHits}`);
    }
  }

  // Materials allow/block (use row.materials if present, else fall back to tags)
  const allowMat = lowerSet(prefs?.materialsAllow || []);
  const blockMat = lowerSet(prefs?.materialsBlock || []);
  if (allowMat.size || blockMat.size) {
    const rowMats = new Set<string>([...lowerList(row?.materials), ...rowCats]);
    const mAllow = intersectCountSet(rowMats, allowMat);
    const mBlock = intersectCountSet(rowMats, blockMat);
    if (mAllow > 0) {
      score += Math.min(10, 4 * mAllow);
      reasons.push(`material+${mAllow}`);
    }
    if (mBlock > 0) {
      score -= Math.min(12, 6 * mBlock);
      reasons.push(`material-${mBlock}`);
    }
  }

  // Certifications required (boost if row advertises any; slight penalty if persona asks but none found)
  const needCerts = lowerSet(prefs?.certsRequired || []);
  if (needCerts.size) {
    const rowCerts = new Set<string>([...lowerList(row?.certs), ...rowCats]);
    const cHits = intersectCountSet(rowCerts, needCerts);
    if (cHits > 0) {
      score += Math.min(10, 4 * cHits);
      reasons.push(`cert+${cHits}`);
    } else {
      score -= 3; // soft nudge; we don't know for sure they lack it
      reasons.push("missing-certs");
    }
  }

  // Keywords add/avoid (search across light blob: name, why, tags, segments)
  const kwAdd = lowerSet(prefs?.keywordsAdd || []);
  const kwAvoid = lowerSet(prefs?.keywordsAvoid || []);
  if (kwAdd.size || kwAvoid.size) {
    const blobTokens = new Set<string>([
      ...lowerList(row?.tags),
      ...lowerList(row?.segments),
      ...lowerList((row?.why || "").split(/[^\w]+/)),
      ...lowerList((row?.name || "").split(/[^\w]+/)),
    ]);
    const addHits = intersectCountSet(blobTokens, kwAdd);
    const avoidHits = intersectCountSet(blobTokens, kwAvoid);
    if (addHits > 0) {
      score += Math.min(8, 2 * addHits);
      reasons.push(`kw+${addHits}`);
    }
    if (avoidHits > 0) {
      score -= Math.min(9, 3 * avoidHits);
      reasons.push(`kw-${avoidHits}`);
    }
  }

  // --- Cap & normalize ---------------------------------------------------
  score = Math.max(0, Math.min(100, score));

  // Keep reasons short-ish
  if (reasons.length > 12) reasons.length = 12;

  return { score, reasons };
}