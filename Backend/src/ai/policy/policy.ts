// src/ai/policy/policy.ts
// Centralized policy engine for data sources, contact discovery, scraping posture,
// plan-based limits, and company-size filters. No external deps.

export type Plan = "free" | "pro" | "scale";
export type Jurisdiction = "us" | "ca" | "eu" | "uk" | "other";
export type DataClass = "public_web" | "account_data" | "contact_personal" | "contact_corporate" | "device" | "telemetry";
export type CompanyType = "buyer" | "supplier" | "packaging_business";

export interface Context {
  orgId: string;
  plan: Plan;
  region?: Jurisdiction;
  tags?: string[];
}

export interface Company {
  domain?: string;
  name?: string;
  type?: CompanyType;
  estRevenueUSD?: number;
  employeeCount?: number;
}

export interface ProviderPolicy {
  id: string; // e.g., "google_custom_search", "serper", "opal", "serpapi", "hf", "gemini", "firecrawl"
  allowedPlans: Plan[];
  dataClasses: DataClass[]; // classes this provider touches
  defaultRateLimitPerMin: number;
  requiresKey?: boolean;
  allowPII?: boolean; // can carry personal contact info across boundary
}

export interface Limits {
  maxPagesPerDomain: number;
  maxDepth: number;
  maxParallel: number;
  obeyRobots: "strict" | "smart" | "off";
  retainDays: number; // retention for raw crawl artifacts
  allowContactDiscovery: boolean;
  allowColdOutreach: boolean;
}

const PROVIDERS: ProviderPolicy[] = [
  { id: "google_custom_search", allowedPlans: ["pro", "scale"], dataClasses: ["public_web"], defaultRateLimitPerMin: 30, requiresKey: true },
  { id: "serper", allowedPlans: ["pro", "scale"], dataClasses: ["public_web"], defaultRateLimitPerMin: 60, requiresKey: true },
  { id: "opal", allowedPlans: ["free", "pro", "scale"], dataClasses: ["public_web"], defaultRateLimitPerMin: 10, requiresKey: false },
  { id: "serpapi", allowedPlans: ["pro", "scale"], dataClasses: ["public_web"], defaultRateLimitPerMin: 30, requiresKey: true },
  { id: "firecrawl", allowedPlans: ["pro", "scale"], dataClasses: ["public_web"], defaultRateLimitPerMin: 60, requiresKey: true },
  { id: "hf_inference", allowedPlans: ["free", "pro", "scale"], dataClasses: ["account_data"], defaultRateLimitPerMin: 100, requiresKey: true },
  { id: "gemini_models", allowedPlans: ["free", "pro", "scale"], dataClasses: ["account_data"], defaultRateLimitPerMin: 60, requiresKey: true },
  { id: "instantly", allowedPlans: ["pro", "scale"], dataClasses: ["contact_corporate", "contact_personal"], defaultRateLimitPerMin: 60, requiresKey: true, allowPII: true },
  { id: "apollo", allowedPlans: ["pro", "scale"], dataClasses: ["contact_corporate", "contact_personal"], defaultRateLimitPerMin: 60, requiresKey: true, allowPII: true },
  { id: "clearbit", allowedPlans: ["pro", "scale"], dataClasses: ["contact_corporate"], defaultRateLimitPerMin: 60, requiresKey: true, allowPII: true },
];

const DEFAULT_LIMITS: Record<Plan, Limits> = {
  free:  { maxPagesPerDomain: 12,  maxDepth: 1, maxParallel: 2,  obeyRobots: "strict", retainDays: 3,  allowContactDiscovery: false, allowColdOutreach: false },
  pro:   { maxPagesPerDomain: 80,  maxDepth: 2, maxParallel: 6,  obeyRobots: "smart",  retainDays: 30, allowContactDiscovery: true,  allowColdOutreach: false },
  scale: { maxPagesPerDomain: 200, maxDepth: 3, maxParallel: 12, obeyRobots: "smart",  retainDays: 90, allowContactDiscovery: true,  allowColdOutreach: true  },
};

export interface PolicyOverrides {
  // e.g., per-jurisdiction overrides
  euContactDiscovery?: boolean; // default false in EU/UK unless explicit consent or legitimate interest documented
  maxSupplierRevenueUSD?: number; // exclude suppliers above this size
}

const DEFAULT_OVERRIDES: PolicyOverrides = {
  euContactDiscovery: false,
  maxSupplierRevenueUSD: 50_000_000, // do not target giant packaging suppliers for users (per product brief)
};

export class PolicyEngine {
  constructor(
    private overrides: PolicyOverrides = DEFAULT_OVERRIDES,
    private providers: ProviderPolicy[] = PROVIDERS,
    private limits: Record<Plan, Limits> = DEFAULT_LIMITS,
  ) {}

  limitsFor(ctx: Context): Limits {
    const base = { ...this.limits[ctx.plan] };
    if (ctx.region === "eu" || ctx.region === "uk") {
      // tighten PII discovery in EU/UK by default
      base.allowContactDiscovery = this.overrides.euContactDiscovery ?? false;
    }
    return base;
  }

  canUseProvider(id: string, ctx: Context, data: DataClass[]): boolean {
    const p = this.providers.find(x => x.id === id);
    if (!p) return false;
    if (!p.allowedPlans.includes(ctx.plan)) return false;
    // ensure provider is compatible with requested data classes
    if (data.some(d => !p.dataClasses.includes(d))) return false;
    // in EU/UK, block PII providers unless override enabled
    if ((ctx.region === "eu" || ctx.region === "uk") && p.allowPII && !this.limitsFor(ctx).allowContactDiscovery) {
      return false;
    }
    return true;
  }

  providerRateLimitPerMin(id: string, ctx: Context): number {
    const p = this.providers.find(x => x.id === id);
    if (!p) return 0;
    // allow modest uplift for higher plans
    const mult = ctx.plan === "scale" ? 2 : ctx.plan === "pro" ? 1.25 : 1;
    return Math.floor(p.defaultRateLimitPerMin * mult);
  }

  shouldExcludeCompany(c: Company, role: "source" | "target"): boolean {
    // We exclude *suppliers/packaging businesses* that are too large for our user base,
    // but do NOT exclude large buyers (retailers/brands).
    if (role === "source" && (c.type === "supplier" || c.type === "packaging_business")) {
      const cap = this.overrides.maxSupplierRevenueUSD ?? DEFAULT_OVERRIDES.maxSupplierRevenueUSD!;
      if ((c.estRevenueUSD ?? 0) > cap) return true;
      if ((c.employeeCount ?? 0) > 1500) return true;
      // known mega-brands by domain quick guard
      if (c.domain && /(^|\.)uline\.com$|(^|\.)packhelp\.com$|(^|\.)westrock\.com$|(^|\.)amcor\.com$/i.test(c.domain)) return true;
    }
    return false;
  }

  canProcess(data: DataClass, ctx: Context): boolean {
    const l = this.limitsFor(ctx);
    if (data === "contact_personal") return l.allowContactDiscovery;
    if (data === "contact_corporate") return l.allowContactDiscovery || ctx.plan !== "free";
    return true;
  }

  retentionDays(ctx: Context): number {
    return this.limitsFor(ctx).retainDays;
  }

  robotsMode(ctx: Context): "strict" | "smart" | "off" {
    return this.limitsFor(ctx).obeyRobots;
  }

  outreachAllowed(ctx: Context): boolean {
    return this.limitsFor(ctx).allowColdOutreach;
  }

  // Sanity caps for crawling per-domain based on plan and robots posture
  crawlCaps(ctx: Context): { maxPages: number; maxDepth: number; maxParallel: number } {
    const l = this.limitsFor(ctx);
    return { maxPages: l.maxPagesPerDomain, maxDepth: l.maxDepth, maxParallel: l.maxParallel };
  }

  // Redact personal fields depending on plan/region
  redact<T extends Record<string, any>>(obj: T, ctx: Context): T {
    const allowPII = this.canProcess("contact_personal", ctx);
    if (allowPII) return obj;
    const clone = { ...obj };
    for (const k of Object.keys(clone)) {
      if (/^((home|personal)?_?(email|phone|mobile|whatsapp|telegram))$/i.test(k)) {
        clone[k] = undefined;
      }
    }
    return clone;
  }
}

// Convenience singleton (optional)
export const policy = new PolicyEngine();
