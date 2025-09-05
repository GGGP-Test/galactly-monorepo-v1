// Standard feature schema + normalizers used across FREE/PRO.
// Keep numeric in [0,1] where possible for stable weighting.

export type PackagingCategory =
  | "corrugated_boxes" | "stretch_wrap" | "poly_mailers" | "tape"
  | "void_fill" | "labels" | "custom_print" | "sustainable";

export type Channel = "email" | "phone" | "linkedin" | "instagram" | "tiktok" | "x" | "website_form";

export interface LeadCore {
  id: string;
  name: string;
  domain?: string;
  country?: string;
  state?: string;
  city?: string;
  revenueUSD?: number;        // annual, rough
  employees?: number;         // rough
  naics?: string[];
  isPackagingSupplier?: boolean; // true if they sell packaging (we filter big ones)
}

export interface DemandSignals {
  adsActive?: boolean;              // any ad activity observed
  adChannels?: Channel[];           // where we observed ads
  recentLaunches90d?: number;       // PR/news mentions about launches
  searchBuzz90d?: number;           // relative search interest / mentions
  jobOpeningsOps30d?: number;       // ops/warehouse/packaging roles
  checkoutDetected?: boolean;       // e-comm checkout present
  orderVolumeProxy?: number;        // 0..1 heuristic from traffic/cart
}

export interface TechSignals {
  platform?: ("shopify"|"magento"|"bigcommerce"|"woocommerce"|"custom") | null;
  analyticsTags?: string[]; // ga4, gtm, pixel, tik_tok, etc.
  shippingStack?: string[]; // shipstation, easyship, etc.
  marketingStack?: string[]; // klaviyo, mailchimp, etc.
}

export interface MatchSignals {
  categoriesNeeded: PackagingCategory[];     // inferred from vertical/products
  categoriesOverlap: number;                 // 0..1 overlap with user categories
  priceBandFit?: number;                     // 0..1 (heuristic from market tier)
  moqFit?: number;                           // 0..1
  leadTimeFit?: number;                      // 0..1
}

export interface BehaviorSignals {
  postsPerWeek?: number;         // company social/blog
  responseLikelihood?: number;   // 0..1 (channel responsiveness heuristic)
  reviewVolume?: number;         // absolute
  reviewSentiment?: number;      // 0..1
  referralLikelihood?: number;   // 0..1 (goodwill proxy)
  vendorChurnHistory?: number;   // 0..1 (lower = sticky)
}

export interface PlatformSignals {
  reachableChannels: Channel[];  // e.g., email+form found
  bestChannel?: Channel | null;  // chosen by bandit/heuristic
}

export interface LeadFeatures {
  core: LeadCore;
  demand: DemandSignals;
  tech: TechSignals;
  match: MatchSignals;
  behavior: BehaviorSignals;
  platform: PlatformSignals;
}

// --- utilities ----

export const clamp01 = (x: number | undefined | null, d = 0): number =>
  Math.max(0, Math.min(1, Number.isFinite(x as number) ? (x as number) : d));

export const z01 = (x: number, min: number, max: number) =>
  max <= min ? 0 : clamp01((x - min) / (max - min));

export interface UserWeights {
  intent: number;    // how fast they’ll buy now
  stay: number;      // how long they’ll stay
  character: number; // goodwill/referrals
  platform: number;  // reachability/likely reply
}

// sane defaults; UI sliders write to these
export const DEFAULT_WEIGHTS: UserWeights = {
  intent: 0.40, stay: 0.25, character: 0.15, platform: 0.20,
};
