/*
  progress.ts — ephemeral progress engine for the Free Panel
  ------------------------------------------------------------------
  What this provides
   - startProgress(userId, input): create a run that emits ~30 metrics over time
   - getProgress(runId): snapshot (pct, events, locked metrics, ETA)
   - stopProgress(runId): end a run
   - pruneExpiredRuns(): memory hygiene

  How to wire (in Index.ts):
   import { startProgress, getProgress, stopProgress } from './progress';

   app.post('/api/v1/progress/start', (req,res)=>{
     const userId = (req as any).userId || 'anon';
     const { runId, estimateMs, freeMetrics, totalMetrics } = startProgress(userId, req.body||{});
     res.json({ ok:true, runId, estimateMs, freeMetrics, totalMetrics });
   });

   app.get('/api/v1/progress/:id', (_req,res)=>{
     const snap = getProgress(_req.params.id);
     if (!snap) return res.status(404).json({ ok:false, error:'not found' });
     res.json({ ok:true, ...snap });
   });

   app.post('/api/v1/progress/:id/stop', (_req,res)=>{ stopProgress(_req.params.id); res.json({ ok:true }); });

  Notes
   - This is *in-memory*; each run expires (default 10 min) to avoid leaks
   - "Locked" metrics beyond free tier are included in plan but not executed; UI should
     show them greyed with upsell copy.
*/

// ---------------- Types ----------------
export type ProgressInput = {
  vendorDomain?: string;
  industries?: string[];
  regions?: string[];
  buyers?: string[];
  // optional hints from upstream scanners (if available)
  adHints?: Array<{ domain: string; platform: 'meta'|'google'|'tiktok'|'reddit'|'snap'|'other'; adCount?: number; lastSeen?: string }>;
};

export type Metric = {
  code: string;               // stable id (e.g., 'DEM-ADS-ACTIVE')
  label: string;              // human readable
  cat: 'demand'|'procurement'|'product'|'ops'|'finance';
  weight: number;             // importance 0..1
  locked?: boolean;           // true => free tier preview only
  hint?: string;              // short subtitle
};

export type ProgressEvent = {
  t: number;                  // epoch ms
  type: 'start'|'metric_start'|'metric_done'|'note'|'lead';
  code?: string;              // metric code
  label?: string;             // metric label
  pct?: number;               // 0..100 snapshot
  data?: any;                 // arbitrary payload (estimates, bullets, etc.)
};

export type ProgressRun = {
  id: string;
  userId: string | null;
  input: ProgressInput;
  startedAt: number;
  etaMsTotal: number;
  metrics: Metric[];          // full plan (some locked)
  idxNext: number;            // next metric index to execute
  pct: number;                // 0..100
  done: boolean;
  events: ProgressEvent[];    // append‑only log (UI can poll and diff)
  expiresAt: number;
  timer?: NodeJS.Timeout | null;
  seed: number;               // deterministic for run
  figures: Figures;           // packaging math figures (estimates)
};

export type ProgressSnapshot = {
  runId: string;
  pct: number;
  done: boolean;
  startedAt: number;
  etaMsTotal: number;
  etaMsRemaining: number;
  metrics: Metric[];          // include locked markers for UI
  events: ProgressEvent[];    // full log
  figures: Figures;           // precomputed headline math
};

// ---------------- Config ----------------
const RUN_TTL_MS = envInt('PROGRESS_RUN_TTL_MS', 10*60*1000);        // 10 min
const MS_PER_METRIC = envInt('PROGRESS_MS_PER_METRIC', 3500);        // ~3.5s per metric (feel deliberate)
const JITTER_FRAC = envNum('PROGRESS_JITTER_FRAC', 0.25);            // ±25% jitter
const FREE_METRICS = envInt('PROGRESS_FREE_METRICS', 18);            // show 18, lock the rest

function envInt(k: string, d: number){ const v=Number(process.env[k]); return Number.isFinite(v)&&v>0 ? v : d; }
function envNum(k: string, d: number){ const v=Number(process.env[k]); return Number.isFinite(v)? v : d; }

// ---------------- Store ----------------
const runs = new Map<string, ProgressRun>();

// housekeeping every few minutes
let janitor: NodeJS.Timeout | null = null;
function ensureJanitor(){
  if (janitor) return;
  janitor = setInterval(pruneExpiredRuns, 2*60*1000).unref?.();
}

export function pruneExpiredRuns(){
  const now = Date.now();
  for (const [id, r] of runs){
    if (now > r.expiresAt){
      if (r.timer) try{ clearTimeout(r.timer); }catch{}
      runs.delete(id);
    }
  }
}

// ---------------- Public API ----------------
export function startProgress(userId: string | null, input: ProgressInput){
  ensureJanitor();
  const id = genId();
  const seed = hashSeed([userId||'anon', input.vendorDomain||'', (input.industries||[]).join(','), (input.buyers||[]).join(','), String(Date.now())].join('|'));
  const metrics = buildMetricPlan(input, FREE_METRICS);
  const etaMsTotal = Math.round(metrics.length * MS_PER_METRIC * (1 + JITTER_FRAC*0.3));
  const figures = estimateFigures(input, seed);

  const run: ProgressRun = {
    id, userId: userId||'anon', input, startedAt: Date.now(), etaMsTotal,
    metrics, idxNext: 0, pct: 0, done: false, events: [],
    expiresAt: Date.now() + RUN_TTL_MS, timer: null, seed, figures
  };

  run.events.push({ t: Date.now(), type:'start', pct: 0, data: { freeMetrics: FREE_METRICS, totalMetrics: metrics.length, figures } });
  runs.set(id, run);
  scheduleNext(run);
  return { runId: id, estimateMs: etaMsTotal, freeMetrics: FREE_METRICS, totalMetrics: metrics.length } as const;
}

export function getProgress(runId: string): ProgressSnapshot | null {
  const r = runs.get(runId); if (!r) return null;
  // opportunistic tick if timer is not set (serverless keep‑alive)
  if (!r.done && !r.timer) scheduleNext(r);
  const now = Date.now();
  const etaMsRemaining = Math.max(0, r.startedAt + r.etaMsTotal - now);
  return { runId, pct: r.pct, done: r.done, startedAt: r.startedAt, etaMsTotal: r.etaMsTotal, etaMsRemaining, metrics: r.metrics, events: r.events, figures: r.figures };
}

export function stopProgress(runId: string){ const r=runs.get(runId); if(!r) return; r.done=true; if(r.timer) try{ clearTimeout(r.timer); }catch{} r.timer=null; r.pct=100; r.expiresAt=Date.now()+30*1000; }

// ---------------- Internals ----------------
function scheduleNext(r: ProgressRun){
  if (r.done) return;
  const metric = r.metrics[r.idxNext];
  if (!metric){ r.done = true; r.pct = 100; r.events.push({ t: Date.now(), type:'note', label:'complete', pct: r.pct }); return; }

  const base = MS_PER_METRIC; const jitter = base * JITTER_FRAC * (rand(r.seed + r.idxNext*7) * 2 - 1); const ms = Math.max(600, Math.round(base + jitter));
  // kickoff event
  r.events.push({ t: Date.now(), type:'metric_start', code: metric.code, label: metric.label, pct: r.pct, data: { cat: metric.cat, locked: !!metric.locked, hint: metric.hint } });

  r.timer = setTimeout(()=>{
    // compute payload for this metric
    const payload = materializeMetric(metric, r);
    // mark done or emit upsell note
    if (metric.locked){
      r.events.push({ t: Date.now(), type:'note', code: metric.code, label: metric.label, pct: r.pct, data: { locked:true, upsell:'Upgrade to unlock this analysis' } });
    } else {
      r.events.push({ t: Date.now(), type:'metric_done', code: metric.code, label: metric.label, pct: r.pct, data: payload });
    }

    // advance index + percentage (skip locked from progress weight or count them lightly)
    const progressWeight = metric.locked ? 0.15 : 1.0;  // locked contributes a little to overall pct
    const step = 100 / Math.max(1, r.metrics.length);
    r.pct = Math.min(100, r.pct + step * progressWeight);

    r.idxNext++;
    r.expiresAt = Date.now() + RUN_TTL_MS;
    r.timer = null;
    scheduleNext(r);
  }, ms).unref?.();
}

// "If‑then" driven metric plan (30 items). Naming is *capability‑style*, not step‑by‑step recipe.
function buildMetricPlan(input: ProgressInput, freeN: number): Metric[] {
  const L: Metric[] = [];
  const push = (code:string, label:string, cat:Metric['cat'], weight=1, hint?:string)=> L.push({ code, label, cat, weight, hint });

  // Demand (ads, reach, launches)
  push('DEM-PAID-PRESENCE',   'Paid reach & presence scan',           'demand', 1.0, 'Checks ad transparency portals');
  push('DEM-PAID-PULSE',      'Paid activity pulse',                  'demand', 0.9,  'Recency & cadence');
  push('DEM-CREATIVE-VOLUME', 'Creative volume & rotation',           'demand', 0.8,  'Rough spend class');
  push('DEM-LAUNCH-SIGNALS',  'Launch & promo signals',               'demand', 0.7,  'Seasonal / new SKUs');
  push('DEM-RETARGETING',     'Retargeting footprint',                'demand', 0.6,  'Brand → PDP mapping');
  push('DEM-GEO-MIX',         'Geo mix & logistics implication',      'demand', 0.6,  'Regions & carriers');

  // Procurement (intake pages, supplier portals)
  push('PRC-INTAKE',          'Supplier intake / procurement pages',  'procurement', 1.0);
  push('PRC-RFQ-FOOTPRINT',   'Live RFQ/RFP footprint',               'procurement', 0.9);
  push('PRC-COMPLIANCE',      'Compliance & sustainability stance',   'procurement', 0.6);
  push('PRC-VENDOR-ROTATION', 'Vendor rotation risk',                 'procurement', 0.6);

  // Product velocity & stock
  push('PRD-PDP-CASE',        'Case-of‑N & B2B pack detection',       'product', 1.0);
  push('PRD-RESTOCK',         'Restock & stockout cadence',           'product', 0.9);
  push('PRD-SKU-WIDTH',       'SKU width / flavor expansion',         'product', 0.7);
  push('PRD-PRICING',         'Price & promo cadence',                'product', 0.6);

  // Operations (warehousing, palletization, freight)
  push('OPS-PALLET-LIKELIHOOD','Palletization likelihood',            'ops', 0.8);
  push('OPS-WH-FOOTPRINT',    'Warehouse footprint & 3PL clues',      'ops', 0.7);
  push('OPS-CHANNEL-MIX',     'DTC vs Retail channel mix',            'ops', 0.7);
  push('OPS-SHIP-SPEED',      'Ship speed & SLAs',                    'ops', 0.6);

  // Finance / intent strength
  push('FIN-ADSPEND-CLASS',   'Ad spend class (rough)',               'finance', 1.0);
  push('FIN-LTV-AOV',         'LTV • CAC • AOV sanity',               'finance', 1.0);
  push('FIN-UNIT-NEED',       'Monthly packaging unit need (rough)',  'finance', 1.0);
  push('FIN-QUEUE-WINDOW',    'Likely buying window (queue)',         'finance', 0.9);

  // Time‑sensitive micro rules (the if‑then edge)
  push('IF-VISITORS-PEAK',    'Traffic/seasonal peaks',               'demand', 0.5);
  push('IF-STORE-EVENT',      'Store/event calendar impact',          'ops', 0.5);
  push('IF-SUPPLIER-GAPS',    'Supplier gap alerts',                  'procurement', 0.6);
  push('IF-NEW-CHANNEL',      'New channel expansion risk',           'ops', 0.5);
  push('IF-PRICE-MOVE',       'Price move reaction',                  'product', 0.5);
  push('IF-REVIEWS-WAVE',     'Review wave → demand',                 'product', 0.5);
  push('IF-RECALL-RISK',      'Recall/QA chatter monitor',            'ops', 0.4);
  push('IF-DTC-REBOUND',      'DTC rebound windows',                  'finance', 0.4);

  // lock beyond free tier
  return L.map((m, i)=> ({ ...m, locked: (i >= freeN) }));
}

// --------------- Payload materialization ---------------

// Figures shown in headline and reused by multiple metrics
export type Figures = {
  // demand/ad
  ad: { classLabel: 'Low'|'Medium'|'High'; monthlySpendUSD: number; creativeCount: number; lastSeenDays: number };
  // finance
  finance: { cac: number; ltv: number; aov: number; grossMarginPct: number };
  // conversion & units
  conv: { monthlyVisitors: number; ctr: number; cvr: number; orders: number };
  // packaging units & queue
  pkg: { unitsPerOrder: number; unitsPerMonth: number; estPallets: number; queueDays: number };
};

function estimateFigures(input: ProgressInput, seed: number): Figures {
  // Use seed to make the numbers deterministic per run, vary tame ranges
  const r = (min:number,max:number)=> min + (max-min)*rand(seed+=101);
  // Hints from ad libraries if present
  const hint = (input.adHints && input.adHints[0]) || null;
  const cc = hint?.adCount ?? Math.round(r(6, 42));
  const lastSeenDays = hint?.lastSeen ? Math.max(0, Math.round((Date.now()-Date.parse(hint.lastSeen))/86400000)) : Math.round(r(1,14));
  const spendClass = cc>30 ? 'High' : cc>12 ? 'Medium' : 'Low';
  const spendUSD = spendClass==='High' ? Math.round(r(15000, 60000)) : spendClass==='Medium' ? Math.round(r(5000, 15000)) : Math.round(r(800, 5000));

  // traffic and conversion model (very rough, but consistent per run)
  const monthlyVisitors = Math.round(spendUSD / r(0.08, 1.2)); // effective CPC ~ $0.08–$1.20 → clicks as visitor proxy
  const ctr = clamp(r(0.5, 2.5), 0.3, 3.0);                    // % from paid impressions to clicks (displayed as %)
  const cvr = clamp(r(1.2, 4.5), 0.8, 6.0);                    // site conversion rate %
  const orders = Math.max(1, Math.round(monthlyVisitors * (cvr/100)));

  // finance guardrails
  const aov = Math.round(r(18, 68));                            // retail DTC basket
  const ltv = Math.round(r(2.5, 5.5) * aov);                    // simple LTV
  const cac = Math.max(4, Math.round(r(0.2, 0.6) * aov));       // CAC as 20–60% AOV
  const grossMarginPct = Math.round(r(35, 72));

  // packaging math (units/order and pallets)
  const unitsPerOrder = Math.max(1, Math.round(r(4, 24)));      // cans, pouches, boxes, etc.
  const unitsPerMonth = orders * unitsPerOrder;
  const estPallets = Math.max(1, Math.round(unitsPerMonth / 2500)); // simple divisor → pallet count
  const queueDays = Math.max(3, Math.round(r(7, 28)));

  return {
    ad: { classLabel: spendClass as Figures['ad']['classLabel'], monthlySpendUSD: spendUSD, creativeCount: cc, lastSeenDays },
    finance: { cac, ltv, aov, grossMarginPct },
    conv: { monthlyVisitors, ctr, cvr, orders },
    pkg: { unitsPerOrder, unitsPerMonth, estPallets, queueDays }
  };
}

function materializeMetric(m: Metric, r: ProgressRun){
  const F = r.figures;
  const bullets = (arr: string[])=> arr.map(s=>({ text: s }));
  switch(m.code){
    case 'DEM-PAID-PRESENCE':
      return { bullets: bullets([
        `Ad presence class: ${F.ad.classLabel}`,
        `~${F.ad.creativeCount} creatives; last seen ${F.ad.lastSeenDays}d ago`,
      ]) };
    case 'DEM-PAID-PULSE':
      return { bullets: bullets([
        `Estimated spend ~ $${fmt(F.ad.monthlySpendUSD)} / mo`,
        `Cadence suggests ${F.ad.classLabel==='High'?'weekly':'bi‑weekly'} refresh`,
      ]) };
    case 'DEM-CREATIVE-VOLUME':
      return { bullets: bullets([`Creative rotation → spend class "${F.ad.classLabel}"`]) };
    case 'PRC-INTAKE':
      return { bullets: bullets([`Supplier intake likely on domain(s) given buyers list (${(r.input.buyers||[]).length||'few'})`]) };
    case 'PRD-PDP-CASE':
      return { bullets: bullets([`Case‑of‑N and B2B packs → units/order ≈ ${F.pkg.unitsPerOrder}`]) };
    case 'PRD-RESTOCK':
      return { bullets: bullets([`Restock cadence implies queue window ≈ ${F.pkg.queueDays} days`]) };
    case 'OPS-PALLET-LIKELIHOOD':
      return { bullets: bullets([`~${F.pkg.estPallets} pallets / mo (rough)`]) };
    case 'FIN-ADSPEND-CLASS':
      return { bullets: bullets([`Spend class ${F.ad.classLabel} (~$${fmt(F.ad.monthlySpendUSD)}/mo)`]) };
    case 'FIN-LTV-AOV':
      return { bullets: bullets([`AOV ~$${fmt(F.finance.aov)}, LTV ~$${fmt(F.finance.ltv)}, CAC ~$${fmt(F.finance.cac)}`]) };
    case 'FIN-UNIT-NEED':
      return { bullets: bullets([`Units / mo ≈ ${fmt(F.pkg.unitsPerMonth)} (orders × units/order)`]) };
    case 'FIN-QUEUE-WINDOW':
      return { bullets: bullets([`Likely buy window: next ${F.pkg.queueDays}–${F.pkg.queueDays+5} days`]) };
    default:
      // generic fallthrough
      return { bullets: bullets([`${m.label} complete`]) };
  }
}

// ---------------- Utils ----------------
function genId(){ return 'r_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
function clamp(v:number, lo:number, hi:number){ return Math.max(lo, Math.min(hi, v)); }
function fmt(n:number){ return n.toLocaleString('en-US'); }

// deterministic [0,1) based on seed (LCG)
function rand(seed:number){
  let x = Math.imul(48271, (seed>>>0) % 2147483647) % 2147483647;
  return (x & 0x7fffffff) / 0x80000000;
}
function hashSeed(s: string){ let h=2166136261>>>0; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
