// tests/policy.spec.ts
import { describe, it, expect } from "vitest";
import { PolicyEngine, policy, type Context, type Company } from "../src/ai/policy/policy";

describe("PolicyEngine: limits & providers", () => {
  const engine = policy;

  it("applies plan-based crawl caps", () => {
    const free: Context = { orgId: "o1", plan: "free", region: "us" };
    const pro: Context = { orgId: "o2", plan: "pro", region: "us" };
    expect(engine.crawlCaps(free)).toEqual({ maxPages: 12, maxDepth: 1, maxParallel: 2 });
    expect(engine.crawlCaps(pro)).toEqual({ maxPages: 80, maxDepth: 2, maxParallel: 6 });
  });

  it("blocks contact discovery by default in EU/UK", () => {
    const eu: Context = { orgId: "o1", plan: "pro", region: "eu" };
    const us: Context = { orgId: "o1", plan: "pro", region: "us" };
    expect(engine.limitsFor(eu).allowContactDiscovery).toBe(false);
    expect(engine.limitsFor(us).allowContactDiscovery).toBe(true);
  });

  it("canUseProvider respects plan & data classes & EU PII guard", () => {
    const eu: Context = { orgId: "o1", plan: "pro", region: "eu" };
    const us: Context = { orgId: "o1", plan: "pro", region: "us" };
    // Public web search allowed everywhere
    expect(engine.canUseProvider("opal", us, ["public_web"])).toBe(true);
    expect(engine.canUseProvider("opal", eu, ["public_web"])).toBe(true);
    // PII providers blocked in EU by default
    expect(engine.canUseProvider("instantly", eu, ["contact_personal"])).toBe(false);
    // But allowed in US for pro plan
    expect(engine.canUseProvider("instantly", us, ["contact_personal"])).toBe(true);
    // Provider not available in free plan
    const freeCtx: Context = { orgId: "o3", plan: "free", region: "us" };
    expect(engine.canUseProvider("serper", freeCtx, ["public_web"])).toBe(false);
  });

  it("rate limit scales with plan", () => {
    const free: Context = { orgId: "o1", plan: "free" };
    const pro: Context = { orgId: "o2", plan: "pro" };
    const scale: Context = { orgId: "o3", plan: "scale" };
    // Using "serper" default 60 / min -> free=60, pro≈75, scale=120
    expect(engine.providerRateLimitPerMin("serper", free)).toBe(60);
    expect(engine.providerRateLimitPerMin("serper", pro)).toBe(75);
    expect(engine.providerRateLimitPerMin("serper", scale)).toBe(120);
  });

  it("excludes too-large suppliers but not large buyers", () => {
    const bigSupplier: Company = { domain: "www.westrock.com", type: "packaging_business", estRevenueUSD: 25_000_000_000 };
    const bigBuyer: Company = { domain: "target.com", type: "buyer", estRevenueUSD: 100_000_000_000 };
    expect(engine.shouldExcludeCompany(bigSupplier, "source")).toBe(true);
    expect(engine.shouldExcludeCompany(bigBuyer, "source")).toBe(false);
  });

  it("redacts PII on free plan / restricted regions", () => {
    const euFree: Context = { orgId: "o1", plan: "free", region: "eu" };
    const proUS: Context = { orgId: "o2", plan: "pro", region: "us" };
    const record = {
      name: "Jane",
      email: "jane@example.com",
      personal_email: "jane@gmail.com",
      phone: "+1-555-1234",
      corporate_email: "jane@acme.com",
      role: "Purchasing",
    };
    const redacted = policy.redact(record, euFree);
    expect(redacted.email).toBeUndefined();
    expect(redacted.personal_email).toBeUndefined();
    expect(redacted.phone).toBeUndefined();
    // corporate_email is also redacted by the simple key matcher in redact:
    expect((redacted as any).corporate_email).toBeUndefined();

    const open = policy.redact(record, proUS);
    expect(open.email).toBe("jane@example.com");
    expect(open.personal_email).toBe("jane@gmail.com");
  });

  it("robots posture varies by plan", () => {
    const free: Context = { orgId: "o1", plan: "free" };
    const pro: Context = { orgId: "o2", plan: "pro" };
    expect(policy.robotsMode(free)).toBe("strict");
    expect(policy.robotsMode(pro)).toBe("smart");
  });
});

describe("PolicyEngine: overrides", () => {
  it("allows customizing supplier max revenue", () => {
    const custom = new PolicyEngine({ maxSupplierRevenueUSD: 10_000_000 });
    const supplier: Company = { type: "packaging_business", estRevenueUSD: 20_000_000 };
    expect(custom.shouldExcludeCompany(supplier, "source")).toBe(true);
  });
});
