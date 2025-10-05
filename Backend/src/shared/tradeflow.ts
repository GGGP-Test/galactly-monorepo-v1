// src/shared/tradeflow.ts
//
// Artemis-B v1 — Trade/ops signal (Incoterms, freight modes, pallets, MOQs, lead times)
// Pure text heuristics. 0..1 score + compact reasons.
//
// Exports:
//   extractTradeflow(text: string): TradeflowSignal
//   summarizeTradeflow(sig: TradeflowSignal): string
//
// Notes: dependency-free, safe for CJS/ESM. Conservative matching.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TradeflowSignal {
  incoterms: string[];                // found Incoterms (FOB, CIF, EXW, DDP, etc.)
  freightModes: {
    ltl: boolean;
    ftl: boolean;
    parcel: boolean;
    intlAir: boolean;
    ocean: boolean;
    drayage: boolean;
  };
  palletHints: {
    mentions: number;                 // count of "pallet"/"skid" mentions
    sizes: string[];                  // e.g., "48x40", "1200x1000"
    materials: string[];              // wood/plastic
  };
  moqUnits: number | null;            // parsed MOQ if any (units)
  leadTimeDays: number | null;        // parsed lead time (best-effort, in days)
  docs: string[];                     // export docs hints (commercial invoice, HS code, COO, MSDS/SDS)
  tradeScore: number;                 // 0..1
  reasons: string[];                  // compact “why”
}

/* --------------------------------- utils ---------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase();
const normWS = (s: string) => s.replace(/\s+/g, " ").trim();

function sat(raw: number, capMax: number): number {
  const x = Math.max(0, Math.min(capMax, raw));
  return capMax > 0 ? x / capMax : 0;
}
function uniq(arr: string[]): string[] {
  const s = new Set<string>();
  for (const v of arr) {
    const t = v.trim();
    if (t) s.add(t);
  }
  return [...s];
}

/* --------------------------------- rules ---------------------------------- */

const INCOTERMS = [
  "EXW","FCA","CPT","CIP","DAP","DPU","DDP",
  "FAS","FOB","CFR","CIF"
] as const;
const INCOTERM_RE = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`, "ig");

const PALLET_SIZE_RE = /\b(4[0-9]{1}x4[0-9]{1}|48x40|1200x1000|1200x800|1140x1140|1100x1100)\b/ig;
const PALLET_WORD_RE = /\b(pallets?|skids?)\b/ig;
const PALLET_MATERIAL_RE = /\b(wood(?:en)?|plastic|composite)\s+pallets?\b/ig;

const MOQ_RE =
  /\b(?:moq|minimum (?:order|purchase) quantity|minimums?)\D{0,12}(\d{1,3}(?:[,\s]\d{3})*|\d+)\b/i;

const LEAD_TIME_RE =
  /\b(?:lead[-\s]?time|ships? (?:in|within)|turn[-\s]?around)\D{0,10}(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*(business\s+)?(day|days|week|weeks)\b/i;

const DOCS: Array<[RegExp,string]> = [
  [/\bcommercial invoice\b/i, "commercial-invoice"],
  [/\bpacking list\b/i, "packing-list"],
  [/\bhs\s*code|harmonized (?:system|code)\b/i, "hs-code"],
  [/\bcertificate of origin\b/i, "coo"],
  [/\bmsds\b|\bsds\b/i, "sds"],
  [/\bexport (?:declaration|docs?)\b/i, "export-docs"],
];

const FREIGHT: Array<[RegExp, keyof TradeflowSignal["freightModes"]]> = [
  [/\bltl\b|\bless[-\s]?than[-\s]?truckload\b/i, "ltl"],
  [/\bftl\b|\bfull[-\s]?truckload\b/i, "ftl"],
  [/\bparcel|small[-\s]?parcel\b/i, "parcel"],
  [/\bair\s*(freight|cargo|express)\b/i, "intlAir"],
  [/\bocean|sea\s*(freight|cargo)\b/i, "ocean"],
  [/\bdrayage\b/i, "drayage"],
];

/* --------------------------------- core ----------------------------------- */

export function extractTradeflow(text: string): TradeflowSignal {
  const raw = normWS(String(text || ""));
  const t = lc(raw);

  const incoterms: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = INCOTERM_RE.exec(raw))) {
    incoterms.push(m[1].toUpperCase());
  }

  const freightModes = { ltl: false, ftl: false, parcel: false, intlAir: false, ocean: false, drayage: false };
  for (const [re, key] of FREIGHT) {
    if (re.test(t)) freightModes[key] = true;
  }

  const palletSizes = uniq((raw.match(PALLET_SIZE_RE) || []).map(s => s.toLowerCase()));
  const palletMentions = (t.match(PALLET_WORD_RE) || []).length;
  const palletMaterials = uniq((t.match(PALLET_MATERIAL_RE) || []).map(s => s.toLowerCase().replace(/\s+pallets?$/, "")));

  let moqUnits: number | null = null;
  const moqMatch = raw.match(MOQ_RE);
  if (moqMatch) {
    const num = Number((moqMatch[1] || "").replace(/[,\s]/g, ""));
    if (Number.isFinite(num)) moqUnits = num;
  }

  let leadTimeDays: number | null = null;
  const lt = raw.match(LEAD_TIME_RE);
  if (lt) {
    const a = Number(lt[1]);
    const b = Number(lt[2] || a);
    const unit = lt[4] || "days";
    const isBiz = Boolean(lt[3]);
    const avg = (a + b) / 2;
    const days = /week/i.test(unit) ? avg * 7 : avg;
    leadTimeDays = Math.round(isBiz ? days * 5/7 : days);
  }

  const docs: string[] = [];
  for (const [re, label] of DOCS) if (re.test(t)) docs.push(label);

  // --- score (cap=10): Incoterms (3), freight (up to 3), pallets (up to 2), MOQ (1), lead (1), docs (up to 2)
  let rawScore = 0;
  rawScore += Math.min(3, uniq(incoterms).length);                                    // 0..3
  rawScore += Object.values(freightModes).filter(Boolean).length;                     // 0..6 (but we cap later)
  rawScore += Math.min(2, palletMentions ? 1 + Math.min(1, palletSizes.length) : 0); // 0..2
  rawScore += moqUnits ? 1 : 0;                                                       // 0..1
  rawScore += leadTimeDays ? 1 : 0;                                                   // 0..1
  rawScore += Math.min(2, docs.length ? 1 + Math.min(1, docs.length - 1) : 0);       // 0..2
  const tradeScore = sat(rawScore, 10);

  const reasons: string[] = [];
  if (incoterms.length) reasons.push(`incoterms:${uniq(incoterms).slice(0,3).join("+")}`);
  const freightOn = Object.entries(freightModes).filter(([,v]) => v).map(([k]) => k);
  if (freightOn.length) reasons.push(`freight:${freightOn.slice(0,3).join("+")}`);
  if (palletMentions) reasons.push(`pallets:${palletMentions}`);
  if (moqUnits) reasons.push(`moq:${moqUnits}`);
  if (leadTimeDays) reasons.push(`lead:${leadTimeDays}d`);
  if (docs.length) reasons.push(`docs:${docs.slice(0,3).join("+")}`);
  if (reasons.length > 8) reasons.length = 8;

  return {
    incoterms: uniq(incoterms),
    freightModes,
    palletHints: { mentions: palletMentions, sizes: palletSizes, materials: palletMaterials },
    moqUnits,
    leadTimeDays,
    docs: uniq(docs),
    tradeScore,
    reasons,
  };
}

export function summarizeTradeflow(sig: TradeflowSignal): string {
  if (!sig) return "no tradeflow signal";
  const pct = Math.round((sig.tradeScore || 0) * 100);
  const inc = sig.incoterms.slice(0, 3).join("/");
  const fm  = Object.entries(sig.freightModes).filter(([,v]) => v).map(([k]) => k).slice(0,3).join("/");
  const lt  = sig.leadTimeDays ? `${sig.leadTimeDays}d` : "n/a";
  const moq = sig.moqUnits ? `${sig.moqUnits}` : "n/a";
  const parts: string[] = [];
  if (inc) parts.push(inc);
  if (fm) parts.push(fm);
  parts.push(`lead:${lt}`, `moq:${moq}`);
  return `${pct}% trade/ops — ${parts.join(" • ")}`;
}

export default { extractTradeflow, summarizeTradeflow };