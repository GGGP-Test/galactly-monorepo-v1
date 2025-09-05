// Computes the 4 column scores + overall 0..100 and Hot/Warm label.

import { clamp01, LeadFeatures, UserWeights, DEFAULT_WEIGHTS, z01 } from "./lead-features";

export interface ColumnScores {
  intent: number;    // 0..1
  stay: number;      // 0..1
  character: number; // 0..1
  platform: number;  // 0..1
}

export interface LeadScore {
  total100: number;           // 0..100
  columns: ColumnScores;
  label: "HOT" | "WARM";
  topFactors: string[];       // explanations
}

// Helper: logistic squashing for “closing soon” feel.
const sigma = (x: number) => 1 / (1 + Math.exp(-x));

export function scoreIntent(f: LeadFeatures): number {
  const d = f.demand;
  const m = f.match;

  // Weighted cues for “likely to buy now”
  const ads = d.adsActive ? 1 : 0;
  const checkout = d.checkoutDetected ? 1 : 0;
  const launches = z01(d.recentLaunches90d ?? 0, 0, 5);
  const buzz = clamp01(d.searchBuzz90d ?? 0);
  const match = clamp01(m.categoriesOverlap);
  const orderProxy = clamp01(d.orderVolumeProxy ?? 0);

  // Emphasize match + active demand
  const raw = 0.30*ads + 0.15*checkout + 0.15*launches + 0.10*buzz + 0.25*match + 0.05*orderProxy;
  return clamp01(sigma(3*raw - 1.2)); // tuneable
}

export function scoreStay(f: LeadFeatures): number {
  const b = f.behavior;
  const churn = 1 - clamp01(b.vendorChurnHistory ?? 0); // lower churn = stickier
  const posts = z01(b.postsPerWeek ?? 0, 0, 5);         // consistent ops cadence
  const moq = clamp01(f.match.moqFit ?? 0);
  const leadTime = clamp01(f.match.leadTimeFit ?? 0);
  return clamp01(0.35*churn + 0.20*posts + 0.25*moq + 0.20*leadTime);
}

export function scoreCharacter(f: LeadFeatures): number {
  const b = f.behavior;
  const sentiment = clamp01(b.reviewSentiment ?? 0);
  const referrals = clamp01(b.referralLikelihood ?? 0);
  const volume = z01(b.reviewVolume ?? 0, 0, 200);
  return clamp01(0.45*sentiment + 0.35*referrals + 0.20*volume);
}

export function scorePlatform(f: LeadFeatures): number {
  const b = f.behavior;
  const reachable = f.platform.reachableChannels.length > 0 ? 1 : 0;
  const best = b.responseLikelihood ?? 0; // 0..1 predicted per best channel
  return clamp01(0.55*best + 0.45*reachable);
}

export function scoreLead(f: LeadFeatures, w: UserWeights = DEFAULT_WEIGHTS): LeadScore {
  const columns = {
    intent:    scoreIntent(f),
    stay:      scoreStay(f),
    character: scoreCharacter(f),
    platform:  scorePlatform(f),
  };

  const total =
    100 * clamp01(
      w.intent*columns.intent +
      w.stay*columns.stay +
      w.character*columns.character +
      w.platform*columns.platform
    );

  // Label thresholds: adjust with data
  const label: "HOT"|"WARM" = total >= 72 && columns.intent >= 0.60 && columns.platform >= 0.55
    ? "HOT"
    : "WARM";

  const factors = Object.entries(columns)
    .sort((a,b) => b[1]-a[1])
    .slice(0,3)
    .map(([k]) => k);

  return { total100: Math.round(total), columns, label, topFactors: factors };
}
