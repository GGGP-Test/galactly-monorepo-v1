// File: Backend/src/connectors/spend.ts
// Purpose: rough ad-spend inference from freely observable signals (ad library queries)
// No external deps. Safe to drop in. Exports a single `estimateSpend` function.

export type Platform =
  | 'meta'      // Facebook/Instagram
  | 'google'    // Google Ads / YouTube
  | 'tiktok'
  | 'pinterest'
  | 'snap'
  | 'linkedin';

export type AdSignal = {
  platform: Platform;
  creatives: number;             // distinct active creatives (or ads surfaced by the library/search)
  regions?: string[];            // ISO-ish or human: ["US","CA"] is fine
  lastSeenDays?: number;         // 0 = today, 1 = yesterday ... 30 = a month ago
  reachHints?: {
    // optional, if you sniff it (sometimes free pages show counts)
    pageFollowers?: number;      // e.g., IG followers, TikTok followers
    videoViews30d?: number;      // sum in last 30 days if you can infer
  };
  evidenceUrl?: string;          // the library/proof URL you show in UI
};

export type SpendBreakdown = {
  platform: Platform;
  monthly_low: number;     // USD
  monthly_high: number;    // USD
  monthly_point: number;   // midpoint
  confidence: number;      // 0..1 per platform
  inputs: {
    creatives: number;
    perCreativeDailyUSD_low: number;
    perCreativeDailyUSD_high: number;
    regionMultiplier: number;
    recencyFactor: number;
  };
  assumptions: string[];   // human readable notes for UI
};

export type SpendEstimate = {
  ok: true;
  total_low: number;
  total_high: number;
  total_point: number;
  confidence: number;           // blended across platforms
  breakdown: SpendBreakdown[];
  assumptions: string[];        // global assumptions you can show in “Why this”
};

// -------------------- tiny helpers --------------------
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function roundUSD(n: number) { return Math.round(n); }
function midpoint(a: number, b: number) { return (a + b) / 2; }
function wMean(values: number[], weights: number[]) {
  const sW = weights.reduce((a,b)=>a+b,0) || 1;
  const sV = values.reduce((a,v,i)=>a+v*(weights[i]||0),0);
  return sV / sW;
}
function normCountry(country?: string) {
  if (!country) return 'US';
  const c = country.trim().toUpperCase();
  if (c === 'USA' || c === 'UNITED STATES') return 'US';
  if (c === 'CANADA' || c === 'CA.') return 'CA';
  return c.slice(0,2);
}

// region multipliers ~ CPM/auction cost + market maturity proxies
const REGION_MULTIPLIER: Record<string, number> = {
  US: 1.00, CA: 0.85, UK: 0.95, IE: 0.85, AU: 0.90, NZ: 0.85,
  DE: 0.85, FR: 0.80, NL: 0.85, SE: 0.85, DK: 0.85, NO: 0.90,
  ES: 0.75, IT: 0.75, PT: 0.70,
  MX: 0.55, BR: 0.50, AR: 0.45, CL: 0.55, CO: 0.45,
  IN: 0.40, PH: 0.35, ID: 0.40, MY: 0.45, SG: 0.90, JP: 0.95, KR: 0.95,
  DEFAULT: 0.65
};

// per-platform daily $ per active creative (low..high).
// Tuned for CPG/food-bev DTC, works “okay” for other SMB retail.
// You can override by industry later if you want.
const BASE_DAILY_PER_CREATIVE_USD: Record<Platform, {low: number; high: number}> = {
  meta:      { low: 12, high: 55 },   // many run 1–5 ad sets at $10–$50/day
  google:    { low: 10, high: 60 },   // search/video mix varies widely
  tiktok:    { low:  8, high: 45 },
  pinterest: { low:  6, high: 30 },
  snap:      { low:  6, high: 28 },
  linkedin:  { low: 25, high: 90 }    // expensive, B2B skew
};

// recency factor (fresh ads → closer to 1, stale → lower weight)
function recencyFactor(days?: number) {
  if (days == null) return 0.9;                // unknown, assume fairly recent
  if (days <= 2) return 1.0;
  if (days <= 7) return 0.9;
  if (days <= 14) return 0.75;
  if (days <= 30) return 0.55;
  return 0.35;                                  // older than a month
}

// crude platform confidence given the inputs we have
function platformConfidence(sig: AdSignal): number {
  const c = clamp(sig.creatives, 0, 40);
  const base = c >= 8 ? 0.85 : c >= 3 ? 0.7 : c >= 1 ? 0.5 : 0.3;
  const rec = recencyFactor(sig.lastSeenDays);
  const regionBonus = (sig.regions && sig.regions.length ? 0.05 : 0);
  const reachBonus = sig.reachHints?.pageFollowers ? clamp(Math.log10(sig.reachHints.pageFollowers)/10, 0, 0.1) : 0;
  return clamp(base * 0.7 + rec * 0.25 + regionBonus + reachBonus, 0.15, 0.95);
}

// derive region multiplier from signals
function regionMultiplier(regions?: string[]) {
  if (!regions || !regions.length) return REGION_MULTIPLIER.DEFAULT;
  const m = regions
    .map(normCountry)
    .map(c => REGION_MULTIPLIER[c] ?? REGION_MULTIPLIER.DEFAULT);
  return wMean(m, m.map(()=>1));
}

function perCreativeDaily(platform: Platform) {
  const p = BASE_DAILY_PER_CREATIVE_USD[platform] || BASE_DAILY_PER_CREATIVE_USD.meta;
  return { low: p.low, high: p.high };
}

// main single-platform calc
function computePlatform(sig: AdSignal): SpendBreakdown {
  const { platform, creatives } = sig;
  const per = perCreativeDaily(platform);
  // heuristic: very high “creatives” from free scraping can include variants; dampen > 20
  const effectiveCreatives = creatives <= 20 ? creatives : Math.round(20 + (creatives - 20) * 0.35);
  const regM = regionMultiplier(sig.regions);
  const rec = recencyFactor(sig.lastSeenDays);

  const dailyLow  = per.low  * effectiveCreatives * regM * rec;
  const dailyHigh = per.high * effectiveCreatives * regM * rec;

  const monthlyLow  = dailyLow  * 30;
  const monthlyHigh = dailyHigh * 30;
  const monthlyMid  = midpoint(monthlyLow, monthlyHigh);

  const conf = platformConfidence(sig);

  // notes to surface in “Why this”
  const assumptions: string[] = [
    `Platform baseline: $${per.low}–$${per.high} per active creative/day (${platform}).`,
    `Detected creatives: ${creatives} (effective=${effectiveCreatives}).`,
    `Region mix factor: ×${regM.toFixed(2)}.`,
    `Recency factor: ×${rec.toFixed(2)} (last seen ${sig.lastSeenDays ?? 'recent'}d).`
  ];
  if (sig.reachHints?.pageFollowers) {
    assumptions.push(`Audience hint: ~${sig.reachHints.pageFollowers.toLocaleString()} followers (minor confidence boost).`);
  }
  if (sig.evidenceUrl) {
    assumptions.push(`Proof URL captured (${platform}).`);
  }

  return {
    platform,
    monthly_low:  roundUSD(monthlyLow),
    monthly_high: roundUSD(monthlyHigh),
    monthly_point: roundUSD(monthlyMid),
    confidence: Number(conf.toFixed(2)),
    inputs: {
      creatives,
      perCreativeDailyUSD_low: per.low,
      perCreativeDailyUSD_high: per.high,
      regionMultiplier: regM,
      recencyFactor: rec
    },
    assumptions
  };
}

// -------------------- PUBLIC API --------------------

export function estimateSpend(
  signals: AdSignal[],
  opts?: { regionsBias?: string[] }  // optional: push overall region if not in signals
): SpendEstimate {
  const clean = (signals || []).filter(s => s && s.platform && Number.isFinite(s.creatives));
  if (!clean.length) {
    return {
      ok: true,
      total_low: 0,
      total_high: 0,
      total_point: 0,
      confidence: 0.25,
      breakdown: [],
      assumptions: [
        'No ad signals detected; showing zero until libraries return activity.',
        'Tip: add example buyers or expand regions to improve detection.'
      ]
    };
  }

  // if no region in any signal, apply optional bias to each
  const anyRegion = clean.some(s => s.regions && s.regions.length);
  const enriched = !anyRegion && opts?.regionsBias?.length
    ? clean.map(s => ({ ...s, regions: opts!.regionsBias }))
    : clean;

  const perPlatform = enriched.map(computePlatform);

  // Sum totals
  const totalLow   = perPlatform.reduce((a,b)=>a + b.monthly_low, 0);
  const totalHigh  = perPlatform.reduce((a,b)=>a + b.monthly_high, 0);
  const totalPoint = perPlatform.reduce((a,b)=>a + b.monthly_point, 0);

  // Blend confidence: weighted by each platform’s monthly_point so “bigger” channels dominate
  const conf = wMean(
    perPlatform.map(p => p.confidence),
    perPlatform.map(p => Math.max(1, p.monthly_point))
  );

  // Rollup assumptions (global)
  const assumptions: string[] = [];
  const platforms = Array.from(new Set(perPlatform.map(p => p.platform)));
  assumptions.push(`Platforms detected: ${platforms.join(', ')}.`);
  if (!anyRegion && opts?.regionsBias?.length) {
    assumptions.push(`Applied region bias: ${opts.regionsBias.join(', ')} (no explicit region detected in libraries).`);
  }
  assumptions.push('Heuristic: monthly = per-creative daily × effective creatives × region × recency × 30.');
  assumptions.push('Range reflects SMB CPG norms; large brands may exceed the high bound.');

  return {
    ok: true,
    total_low:  roundUSD(totalLow),
    total_high: roundUSD(totalHigh),
    total_point: roundUSD(totalPoint),
    confidence: Number(clamp(conf, 0.15, 0.95).toFixed(2)),
    breakdown: perPlatform,
    assumptions
  };
}

// -------------------- EXAMPLE (commented) --------------------
/*
const eg = estimateSpend([
  { platform: 'meta', creatives: 9, regions: ['US','CA'], lastSeenDays: 2, evidenceUrl: 'https://facebook.com/ads/library/?q=brand.com' },
  { platform: 'google', creatives: 5, regions: ['US'], lastSeenDays: 7, evidenceUrl: 'https://adstransparency.google.com/advertiser/...' }
], { regionsBias: ['US'] });

console.log(JSON.stringify(eg, null, 2));
*/
