/*
 * packagingmath.ts — heuristic packaging demand + "why" explainer
 *
 * Pure TypeScript (no external deps). Safe for NF/Render lambdas.
 * Turn public signals (ad proofs, PDP hints, intake flags) + vendor context
 * into approximate packaging demand, queue window and human‑readable reasons.
 *
 * NOTE: All numbers are FIRST‑PASS ESTIMATES meant for ranking/sorting and
 * free‑tier previews. Use paid enrichers to tighten bounds later.
 */

// --------------------------- Types ---------------------------
export type AdPlatform = 'meta' | 'google' | 'tiktok' | 'reddit' | 'other';

export type AdProof = {
  platform: AdPlatform;
  proofUrl?: string;               // transparency/search URL users can click
  creatives?: number;              // distinct creatives observed (approx)
  activeAds?: number;              // currently running ads
  geo?: string[];                  // e.g., ['US','CA']
  cadence?: 'always_on'|'seasonal'|'launch'|'promo'|'unknown';
  lastSeenDays?: number;           // days since last observed ad
};

export type PdpSignal = {
  url: string;
  type: 'case_of'|'dimension'|'restock_post'|'new_sku'|'bundle'|'subscription';
  title?: string;
  snippet?: string;
  packOf?: number;                 // parsed pack size (e.g., 12)
};

export type IntakeSignal = { url: string; title?: string; snippet?: string };

export type VendorContext = {
  industry?: string;               // 'beverage','food','supplements','cosmetics','apparel','industrial', ...
  packaging?: string[];            // e.g. ['corrugated','labels','shrink','cans','pouches']
  unitsPerOrder?: number;          // default per industry
  packs?: number[];                // e.g., [6,12,24]
  region?: string;                 // primary selling region ('US','CA',...)
};

export type SpendInputs = {
  proofs: AdProof[];
  brandSize?: 'seed'|'sm'|'mid'|'enterprise'|'unknown';
};

export type DemandInputs = {
  spendUSD: number;                // monthly ad spend midpoint
  industry: string;                // normalized industry
  aovUSD?: number;                 // override average order value if known
  grossMargin?: number;            // override margin if known
  unitsPerOrder?: number;          // override default pack size
};

export type PackagingDemand = {
  units: number;                   // monthly consumer units
  orders: number;                  // monthly orders
  cases?: number;                  // corrugated cases (if applicable)
  labels?: number;                 // unit labels or sleeves
  shrinkFeet?: number;             // shrink film feet estimate
  pallets?: number;                // pallets/month for outbound
};

export type QueueWindow = {
  startIso: string;                // suggested outreach start (ISO)
  endIso: string;                  // window end
  confidence: number;              // 0..1
  rationale: string[];             // short bullets describing timing logic
};

export type SourceRef = {
  kind: 'adlib'|'pdp'|'intake'|'calc'|'user';
  url?: string;
  jsonPath?: string;               // if data came from JSON path
  metric?: string;                 // name of metric
};

export type WhyLine = {
  tag: 'demand'|'product'|'procurement'|'timing'|'math'|'spend'|'ops';
  text: string;                    // user‑facing bullet
  score?: number;                  // contribution to heat/score (−1..+1)
  source?: SourceRef[];
};

export type PackagingMathInput = {
  domain: string;
  vendor: VendorContext;
  ad: SpendInputs;
  pdp: PdpSignal[];
  intake: IntakeSignal[];
  now?: Date;                      // inject clock for tests
};

export type PackagingMathOutput = {
  ok: true;
  domain: string;
  spend: { low: number; mid: number; high: number; confidence: number; notes: string[] };
  demand: PackagingDemand & { confidence: number };
  qwin: QueueWindow;
  why: WhyLine[];
};

// --------------------------- Heuristics ---------------------------

const IND_BENCH: Record<string, { aov: number; margin: number; cacToAov: [number, number]; unitsPerOrder: number; casesPerPallet?: number; shrinkFeetPerCase?: number; labelPerUnit?: boolean }>
= {
  beverage:     { aov: 35, margin: 0.55, cacToAov: [0.28, 0.42], unitsPerOrder: 12, casesPerPallet: 100, shrinkFeetPerCase: 5.0, labelPerUnit: true },
  food:         { aov: 30, margin: 0.50, cacToAov: [0.25, 0.40], unitsPerOrder: 6,  casesPerPallet: 90,  shrinkFeetPerCase: 4.0, labelPerUnit: true },
  supplements:  { aov: 45, margin: 0.70, cacToAov: [0.30, 0.50], unitsPerOrder: 1,  casesPerPallet: 120, shrinkFeetPerCase: 3.0, labelPerUnit: true },
  cosmetics:    { aov: 30, margin: 0.65, cacToAov: [0.25, 0.45], unitsPerOrder: 1,  casesPerPallet: 110, shrinkFeetPerCase: 3.0, labelPerUnit: true },
  apparel:      { aov: 50, margin: 0.60, cacToAov: [0.20, 0.40], unitsPerOrder: 1,  casesPerPallet: 80,  shrinkFeetPerCase: 2.5, labelPerUnit: false },
  industrial:   { aov: 2000, margin: 0.30, cacToAov: [0.05, 0.15], unitsPerOrder: 1, casesPerPallet: 60,  shrinkFeetPerCase: 6.0, labelPerUnit: false }
};

function clamp(n: number, lo: number, hi: number){ return Math.max(lo, Math.min(hi, n)); }
function nz(n: any, d=0){ const v = Number(n); return Number.isFinite(v) ? v : d; }
function safeDiv(a: number, b: number, d=0){ return b>0 ? a/b : d; }
function mean(a: number, b: number){ return (a+b)/2; }
function sum(arr: number[]){ return arr.reduce((x,y)=>x+y,0); }

function normalizeIndustry(ind?: string){
  if(!ind) return 'beverage';
  const s = ind.toLowerCase();
  if (s.includes('bev')) return 'beverage';
  if (s.includes('supplement')||s.includes('vitamin')) return 'supplements';
  if (s.includes('cosm')||s.includes('beaut')) return 'cosmetics';
  if (s.includes('apparel')||s.includes('fashion')) return 'apparel';
  if (s.includes('indus')||s.includes('b2b')||s.includes('factory')) return 'industrial';
  if (s.includes('food')||s.includes('snack')||s.includes('grocery')) return 'food';
  return s;
}

// --------------------------- Spend Estimation ---------------------------

export function estimateMonthlyAdSpendUSD(input: SpendInputs){
  const proofs = Array.isArray(input.proofs) ? input.proofs : [];
  if (!proofs.length) return { low: 0, mid: 0, high: 0, confidence: 0, notes: ['no-ad-signal'] } as const;

  let base = 0; const notes: string[] = [];
  for (const p of proofs){
    const creatives = clamp(nz(p.creatives, 0), 0, 500);
    const active    = clamp(nz(p.activeAds, 0), 0, 500);
    const geoFactor = clamp((p.geo?.length||1) * 0.85, 0.85, 3.5);
    const cadenceK  = p.cadence==='always_on'? 1.0 : p.cadence==='promo'? 0.8 : p.cadence==='seasonal'? 0.7 : p.cadence==='launch'? 0.9 : 0.85;
    const staleness = p.lastSeenDays!=null ? clamp(1 - nz(p.lastSeenDays,0)/45, 0, 1) : 0.8; // fade if last seen long ago
    const platformK = p.platform==='meta'? 1.0 : p.platform==='google'? 0.9 : p.platform==='tiktok'? 0.7 : 0.6;

    // Heuristic dollars: creatives & actives indicate scale. Tuned for free-tier coarse bounds.
    const dollars = ((creatives*120) + (active*150) + 400) * geoFactor * cadenceK * platformK * staleness;
    base += dollars;
    notes.push(`${p.platform}:$${Math.round(dollars)}`);
  }

  // brand size multiplier
  const sizeK = input.brandSize==='enterprise'? 1.6 : input.brandSize==='mid'? 1.25 : input.brandSize==='sm'? 0.85 : input.brandSize==='seed'? 0.6 : 1.0;
  base *= sizeK;

  const low = Math.round(base*0.55);
  const mid = Math.round(base);
  const high= Math.round(base*1.8);
  const confidence = clamp(0.35 + 0.1*proofs.length, 0.35, 0.85);
  return { low, mid, high, confidence, notes };
}

// --------------------------- Demand from Spend ---------------------------

export function estimateDemandFromSpend(inp: DemandInputs){
  const ind = normalizeIndustry(inp.industry);
  const b   = IND_BENCH[ind] || IND_BENCH['food'];

  const aov   = nz(inp.aovUSD, b.aov);
  const ratio = mean(b.cacToAov[0], b.cacToAov[1]);
  const cac   = clamp(aov * ratio, 3, aov*0.9);

  const orders = clamp(safeDiv(inp.spendUSD, cac, 0), 0, 1e9);
  const unitsPerOrder = nz(inp.unitsPerOrder, b.unitsPerOrder);
  const units = orders * unitsPerOrder;

  // packaging primitives (best‑effort)
  const cases = unitsPerOrder>1 ? safeDiv(units, unitsPerOrder, 0) : 0;
  const pallets = b.casesPerPallet ? safeDiv(cases, b.casesPerPallet, 0) : 0;
  const shrinkFeet = b.shrinkFeetPerCase ? cases * b.shrinkFeetPerCase : 0;
  const labels = b.labelPerUnit ? units : 0;

  const conf = 0.45; // improved by paid enrichers later
  return { units, orders, cases, pallets, shrinkFeet, labels, confidence: conf } as PackagingDemand & { confidence: number };
}

// --------------------------- Queue window (Q‑window) ---------------------------

export function deriveQueueWindow(now: Date, demand: PackagingDemand, ind: string, cadence: 'steady'|'spiky'|'promo', leadTimeDays=12){
  const baseDos = ind==='beverage'? 21 : ind==='supplements'? 28 : ind==='apparel'? 35 : 24; // days of supply they likely carry
  const buffer  = cadence==='promo'? 10 : cadence==='spiky'? 7 : 5;
  const start = new Date(now.getTime());
  const end   = new Date(now.getTime() + (leadTimeDays+buffer)*86400000);
  const rationale = [
    `Lead time ≈ ${leadTimeDays}d`,
    `Buffer ${buffer}d for ${cadence}`,
    `DOS baseline ${baseDos}d (${ind})`
  ];
  const confidence = clamp(0.5 + (demand.orders>200?0.2:0) + (cadence==='promo'?0.1:0), 0.4, 0.9);
  return { startIso: start.toISOString(), endIso: end.toISOString(), confidence, rationale } as QueueWindow;
}

// --------------------------- Why builder ---------------------------

export function buildWhyLines(domain: string, spend: ReturnType<typeof estimateMonthlyAdSpendUSD>, pdp: PdpSignal[], intake: IntakeSignal[], ind: string): WhyLine[] {
  const lines: WhyLine[] = [];

  // Spend/demand evidence
  if (spend.mid>0){
    lines.push({ tag:'spend', score: +0.5, text: `${domain} shows active paid demand (~$${fmt(spend.mid)}/mo).`, source: spend.notes.map(n=>({kind:'adlib', metric:n})) });
  } else {
    lines.push({ tag:'spend', score: -0.2, text: `No recent paid demand signals detected.` });
  }

  // PDP signals
  const packs = pdp.filter(p=>p.packOf && p.packOf>1);
  if (packs.length){
    const ex = packs[0];
    lines.push({ tag:'product', score:+0.2, text:`Retail packs detected (e.g., "case of ${ex.packOf}") — implies case‑ready outbound.`, source: [{kind:'pdp', url: ex.url, jsonPath: '$.packOf'}] });
  }

  // Intake / procurement surface
  if (intake.length){
    lines.push({ tag:'procurement', score:+0.3, text:`Supplier/procurement surface is present — they onboard vendors.`, source: intake.slice(0,2).map(x=>({kind:'intake', url:x.url})) });
  }

  // Timing
  lines.push({ tag:'timing', score:+0.1, text:`Outreach window opened based on lead time + buffer for ${ind}.`, source:[{kind:'calc', metric:'q-window'}] });

  return lines;
}

// --------------------------- Main orchestrator ---------------------------

export function runPackagingMath(input: PackagingMathInput): PackagingMathOutput {
  const domain = input.domain;
  const now = input.now || new Date();

  // 1) Spend from ad proofs
  const spend = estimateMonthlyAdSpendUSD({ proofs: input.ad.proofs, brandSize: input.ad.brandSize||'unknown' });

  // 2) Demand from spend using vendor/industry context
  const ind = normalizeIndustry(input.vendor.industry||'');
  const unitsPerOrder = input.vendor.unitsPerOrder || chooseUnitsFromPdp(input.pdp) || IND_BENCH[ind]?.unitsPerOrder || 1;
  const demand = estimateDemandFromSpend({ spendUSD: spend.mid, industry: ind, unitsPerOrder });

  // 3) Queue window from demand & cadence proxy
  const cadence: 'steady'|'spiky'|'promo' = cadenceFromProofs(input.ad.proofs);
  const qwin = deriveQueueWindow(now, demand, ind, cadence, 12);

  // 4) Why (bullets)
  const why = buildWhyLines(domain, spend, input.pdp, input.intake, ind);

  return { ok: true, domain, spend, demand, qwin, why };
}

// --------------------------- Helpers ---------------------------

function cadenceFromProofs(proofs: AdProof[]): 'steady'|'spiky'|'promo' {
  if (!proofs.length) return 'steady';
  const hasPromo = proofs.some(p=>p.cadence==='promo'||p.cadence==='launch');
  const hasSeasonal = proofs.some(p=>p.cadence==='seasonal');
  if (hasPromo) return 'promo';
  if (hasSeasonal) return 'spiky';
  return 'steady';
}

function chooseUnitsFromPdp(pdp: PdpSignal[]): number|undefined {
  const packs = pdp.map(p=>p.packOf||0).filter(n=>n>1);
  if (packs.length){
    // choose mode (~most common pack)
    const freq = new Map<number, number>();
    for (const n of packs) freq.set(n, (freq.get(n)||0)+1);
    let best = packs[0], bestC = 0;
    freq.forEach((c,n)=>{ if(c>bestC){ best=n; bestC=c; } });
    return best;
  }
  return undefined;
}

export function fmt(n: number){
  const a = Math.abs(n);
  if (a>=1_000_000) return (n/1_000_000).toFixed(1)+'M';
  if (a>=10_000) return Math.round(n/1000)+'k';
  return String(Math.round(n));
}

// --------------------------- Debug sample ---------------------------

export function __demo(){
  const out = runPackagingMath({
    domain: 'drinkolipop.com',
    vendor: { industry: 'beverage', packaging: ['corrugated','labels','shrink'], region:'US' },
    ad: { proofs: [
      { platform:'meta', creatives: 22, activeAds: 18, geo:['US'], cadence:'always_on', lastSeenDays: 2 },
      { platform:'google', creatives: 8, activeAds: 6,  geo:['US','CA'], cadence:'promo', lastSeenDays: 3 }
    ], brandSize:'mid' },
    pdp: [ { url:'https://drinkolipop.com/products/classic', type:'case_of', packOf: 12 } ],
    intake: [],
  });
  return out;
}
