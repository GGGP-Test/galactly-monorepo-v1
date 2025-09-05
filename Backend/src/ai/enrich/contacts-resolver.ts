// src/ai/enrich/contacts-resolver.ts

/**
 * ContactsResolver
 * ----------------
 * Aggregates contacts from multiple vendors (Apollo, Clearbit, Instantly, etc.),
 * de-duplicates, filters out generic/non-personal emails, respects compliance/DNC,
 * and returns ranked contacts for a given company/domain.
 *
 * Notes:
 * - All vendor connectors are optional. They auto-disable if no API key/env is provided.
 * - Endpoints are configurable via env to avoid hard-coding and ease self-hosting.
 * - Uses simple in-memory TTL cache; swap with your KV/Redis if available.
 */

import { Compliance } from "../core/compliance";

export type PlanTier = "free" | "pro" | "scale";

export interface ResolveContactsInput {
  domain?: string;             // preferred
  website?: string;
  companyName?: string;
  countryIn?: string[];        // e.g., ["US", "CA"]
  minSeniority?: Array<"owner" | "cxo" | "vp" | "director" | "manager" | "lead" | "staff">;
  titleIncludes?: string[];    // e.g., ["packaging", "procurement", "purchasing", "supply"]
  titleExcludes?: string[];
  maxResults?: number;         // cap total returned
  plan?: PlanTier;             // feature gating
  // heuristics
  preferDirect?: boolean;      // non-generic email preference
  excludeGeneric?: boolean;    // remove info@, sales@, etc.
  // scoring
  weightTitle?: number;        // default 0.45
  weightSeniority?: number;    // default 0.35
  weightSourceConfidence?: number; // default 0.2
}

export interface ContactRecord {
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  seniority?: string;
  phone?: string;
  linkedin?: string;
  location?: string; // "US, NJ" etc.
  countryCode?: string;
  company?: {
    name?: string;
    domain?: string;
    website?: string;
    size?: string;      // "11-50", "51-200", etc.
    employeeCount?: number;
    revenueRange?: string; // "0-50M", etc.
    industry?: string;
    source?: string;
  };
  source?: string;       // vendor id
  confidence?: number;   // 0..1 vendor-provided or heuristic
  raw?: any;             // original vendor payload (optional)
}

export interface VendorResult {
  vendor: string;
  contacts: ContactRecord[];
  quotaUsed?: number;
  rateLimited?: boolean;
}

interface Vendor {
  id: string;
  isEnabled(): boolean;
  findCompanyContacts(input: ResolveContactsInput): Promise<VendorResult>;
}

// -------------------- Utilities --------------------

const GENERIC_EMAILS_RX =
  /^(info|sales|support|hello|contact|admin|team|hi|help|billing|orders|careers|office|enquiries|enquiry|customerservice|service|marketing|press|media|pr|noreply|no-reply|donotreply)@/i;

const DEFAULT_COUNTRIES = ["US", "CA"];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(private ttlSec: number) {}
  get(k: string): V | undefined {
    const hit = this.map.get(k);
    if (!hit) return undefined;
    if (hit.exp < nowSec()) {
      this.map.delete(k);
      return undefined;
    }
    return hit.v;
  }
  set(k: string, v: V) {
    this.map.set(k, { v, exp: nowSec() + this.ttlSec });
  }
}

const cache = new TtlCache<VendorResult[]>(60 * 20); // 20 minutes

function computeCacheKey(input: ResolveContactsInput) {
  const obj = {
    d: input.domain?.toLowerCase(),
    w: input.website?.toLowerCase(),
    c: input.companyName?.toLowerCase(),
    co: (input.countryIn ?? DEFAULT_COUNTRIES).sort(),
    s: input.minSeniority ?? [],
    ti: (input.titleIncludes ?? []).map((x) => x.toLowerCase()).sort(),
    te: (input.titleExcludes ?? []).map((x) => x.toLowerCase()).sort(),
    m: input.maxResults ?? 20,
  };
  return JSON.stringify(obj);
}

function withTimeout<T>(p: Promise<T>, ms = 10000, label = "request"): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function pickCompanyDomain(input: ResolveContactsInput): string | undefined {
  if (input.domain) return normalizeDomain(input.domain);
  if (input.website) {
    try {
      return new URL(input.website).hostname.toLowerCase();
    } catch {
      return normalizeDomain(input.website);
    }
  }
  return undefined;
}

function normalizeDomain(d?: string) {
  if (!d) return d;
  return d.replace(/^https?:\/\//i, "").replace(/\/.+$/, "").toLowerCase();
}

function titleMatchScore(title: string, includes: string[] = [], excludes: string[] = []): number {
  const t = (title || "").toLowerCase();
  if (!t) return 0;
  if (excludes.some((x) => t.includes(x.toLowerCase()))) return 0;
  const hits = includes.map((x) => (t.includes(x.toLowerCase()) ? 1 : 0)).reduce((a, b) => a + b, 0);
  if (!includes.length) return 0.2; // neutral if no includes provided
  return Math.min(1, hits / Math.max(2, includes.length)); // soft cap
}

function seniorityScore(s?: string, min?: ResolveContactsInput["minSeniority"]): number {
  if (!s) return 0;
  const order = ["staff", "lead", "manager", "director", "vp", "cxo", "owner"];
  const idx = order.indexOf((s || "").toLowerCase());
  if (idx < 0) return 0.2;
  if (!min || !min.length) return (idx + 1) / order.length;
  const minBest = Math.min(...min.map((m) => order.indexOf(m)).filter((x) => x >= 0));
  if (minBest < 0) return (idx + 1) / order.length;
  return idx >= minBest ? 0.9 : 0.3;
}

function isGenericEmail(e?: string) {
  if (!e) return false;
  const local = e.split("@")[0] || "";
  return GENERIC_EMAILS_RX.test(e) || /^\d+$/.test(local);
}

function mergeContacts(...lists: ContactRecord[][]): ContactRecord[] {
  const byEmail = new Map<string, ContactRecord>();
  const fallbacks: ContactRecord[] = [];

  const add = (c: ContactRecord) => {
    const key = (c.email || "").toLowerCase();
    if (key) {
      const prev = byEmail.get(key);
      if (!prev) byEmail.set(key, c);
      else {
        // Merge lightweight
        byEmail.set(key, {
          ...prev,
          ...c,
          company: { ...(prev.company ?? {}), ...(c.company ?? {}) },
          confidence: Math.max(prev.confidence ?? 0, c.confidence ?? 0),
          source: [prev.source, c.source].filter(Boolean).join("+"),
          raw: undefined, // don't accumulate heavy payloads
        });
      }
    } else {
      fallbacks.push(c);
    }
  };

  for (const list of lists) for (const c of list) add(c);
  return [...byEmail.values(), ...fallbacks];
}

function rankContacts(
  contacts: ContactRecord[],
  input: ResolveContactsInput
): ContactRecord[] {
  const wTitle = input.weightTitle ?? 0.45;
  const wSen = input.weightSeniority ?? 0.35;
  const wConf = input.weightSourceConfidence ?? 0.2;

  return contacts
    .map((c) => {
      const score =
        (titleMatchScore(c.title ?? "", input.titleIncludes, input.titleExcludes) * wTitle) +
        (seniorityScore(c.seniority, input.minSeniority) * wSen) +
        ((c.confidence ?? 0.3) * wConf) +
        (input.preferDirect && c.email && !isGenericEmail(c.email) ? 0.08 : 0);

      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

// -------------------- Vendors --------------------
// Each vendor has very thin logic. Real-world implementations should handle paging.

class ApolloVendor implements Vendor {
  id = "apollo";
  isEnabled() {
    return !!(process.env.APOLLO_API_KEY || process.env.APOLLO_API_KEYS);
  }
  private token(): string | undefined {
    const multi = process.env.APOLLO_API_KEYS?.split(",").map((s) => s.trim()).filter(Boolean);
    return (multi && multi[Math.floor(Math.random() * multi.length)]) || process.env.APOLLO_API_KEY;
  }
  async findCompanyContacts(input: ResolveContactsInput): Promise<VendorResult> {
    const base = process.env.APOLLO_BASE_URL || "https://api.apollo.io/v1";
    const token = this.token();
    if (!token) return { vendor: this.id, contacts: [] };

    const domain = pickCompanyDomain(input);
    const url = `${base}/mixed_people/search`;
    const body = {
      q_organization_domains: domain ? [domain] : undefined,
      page: 1,
      per_page: Math.min(25, input.maxResults ?? 10),
      person_titles: (input.titleIncludes ?? []).join(" "),
      seniority_levels: input.minSeniority,
      country: (input.countryIn ?? DEFAULT_COUNTRIES).join(","),
    };

    const res = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-API-Key": token,
        },
        body: JSON.stringify(body),
      }),
      12000,
      "apollo search"
    );

    if (!res.ok) {
      if (res.status === 429) return { vendor: this.id, contacts: [], rateLimited: true };
      return { vendor: this.id, contacts: [] };
    }

    const data = await res.json();
    const people = (data?.people ?? []) as any[];

    const contacts: ContactRecord[] = people.map((p) => ({
      email: p.email || p.primary_email,
      firstName: p.first_name,
      lastName: p.last_name,
      fullName: p.name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
      title: p.title,
      seniority: (p.seniority || p.seniority_level)?.toLowerCase(),
      phone: p.phone_numbers?.[0]?.raw_number,
      linkedin: p.linkedin_url,
      location: p.country || p.location_general,
      countryCode: p.country,
      company: {
        name: p.organization?.name,
        domain: p.organization?.website_url || p.organization?.primary_domain,
        size: p.organization?.estimated_num_employees || p.organization?.size,
        employeeCount: p.organization?.employee_count,
        industry: p.organization?.industry,
        source: "apollo",
      },
      source: this.id,
      confidence: 0.7,
      raw: undefined,
    }));

    return { vendor: this.id, contacts };
  }
}

class ClearbitVendor implements Vendor {
  id = "clearbit";
  isEnabled() {
    return !!process.env.CLEARBIT_API_KEY;
  }
  private auth() {
    return "Basic " + Buffer.from(`${process.env.CLEARBIT_API_KEY}:`).toString("base64");
  }
  async companyLookup(domain: string): Promise<any | undefined> {
    const base = process.env.CLEARBIT_COMPANY_URL || "https://company.clearbit.com/v2/companies/find?domain=";
    const res = await withTimeout(fetch(base + encodeURIComponent(domain), {
      headers: { Authorization: this.auth() },
    }), 10000, "clearbit company");
    if (!res.ok) return undefined;
    return res.json();
  }
  async personLookup(email: string): Promise<any | undefined> {
    const base = process.env.CLEARBIT_PERSON_URL || "https://person.clearbit.com/v2/people/find?email=";
    const res = await withTimeout(fetch(base + encodeURIComponent(email), {
      headers: { Authorization: this.auth() },
    }), 10000, "clearbit person");
    if (!res.ok) return undefined;
    return res.json();
  }
  async findCompanyContacts(input: ResolveContactsInput): Promise<VendorResult> {
    const domain = pickCompanyDomain(input);
    if (!domain) return { vendor: this.id, contacts: [] };

    const company = await this.companyLookup(domain).catch(() => undefined);

    // Clearbit person discovery via role is not publicly available in the free tier.
    // We attempt a heuristic: synthesize potential role emails and check the person endpoint.
    const possibleLocalParts = [
      "procurement", "purchasing", "buyer", "supply", "operations", "op", "ops",
      "supplychain", "warehouse", "packaging"
    ];

    const emailsToTry: string[] = [];
    for (const lp of possibleLocalParts) emailsToTry.push(`${lp}@${domain}`);

    const results: ContactRecord[] = [];
    for (const e of emailsToTry.slice(0, Math.min(8, input.maxResults ?? 8))) {
      const p = await this.personLookup(e).catch(() => undefined);
      if (!p) continue;
      results.push({
        email: p.email,
        firstName: p.name?.givenName,
        lastName: p.name?.familyName,
        fullName: p.name?.fullName,
        title: p.employment?.title,
        seniority: (p.employment?.seniority || "").toLowerCase(),
        linkedin: p.linkedin?.handle ? `https://www.linkedin.com/${p.linkedin.handle}` : undefined,
        location: p.geo?.country,
        countryCode: p.geo?.countryCode,
        phone: undefined,
        company: {
          name: company?.name || p.employment?.name,
          domain: company?.domain || domain,
          website: company?.site?.url,
          size: company?.metrics?.employees ? `${company?.metrics?.employees}` : undefined,
          employeeCount: company?.metrics?.employees,
          revenueRange: company?.metrics?.annualRevenue ? `$${company?.metrics?.annualRevenue}` : undefined,
          industry: company?.category?.industry,
          source: "clearbit",
        },
        source: this.id,
        confidence: 0.55,
      });
    }

    return { vendor: this.id, contacts: results };
  }
}

class InstantlyVendor implements Vendor {
  id = "instantly";
  isEnabled() {
    return !!process.env.INSTANTLY_API_KEY && !!(process.env.INSTANTLY_BASE_URL || process.env.INSTANTLY_PROSPECTS_URL);
  }
  async findCompanyContacts(input: ResolveContactsInput): Promise<VendorResult> {
    // Instantly API endpoints vary by account; we rely on env-provided base URLs.
    // Example (subject to your account features):
    //  - INSTANTLY_BASE_URL=https://api.instantly.ai/api/v1
    //  - Prospects Search:  POST /prospects/search  { domain, title_contains, country }
    const base = process.env.INSTANTLY_BASE_URL;
    const prospectsUrl = process.env.INSTANTLY_PROSPECTS_URL || (base ? `${base}/prospects/search` : undefined);
    if (!prospectsUrl) return { vendor: this.id, contacts: [] };

    const domain = pickCompanyDomain(input);
    const body = {
      domain,
      title_contains: (input.titleIncludes ?? []).join(" "),
      country: (input.countryIn ?? DEFAULT_COUNTRIES).join(","),
      limit: Math.min(25, input.maxResults ?? 10),
    };

    const res = await withTimeout(fetch(prospectsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.INSTANTLY_API_KEY as string,
      },
      body: JSON.stringify(body),
    }), 12000, "instantly search");

    if (!res.ok) {
      if (res.status === 429) return { vendor: this.id, contacts: [], rateLimited: true };
      return { vendor: this.id, contacts: [] };
    }
    const data = await res.json();
    const prospects = (data?.prospects ?? data?.results ?? []) as any[];

    const contacts: ContactRecord[] = prospects.map((p) => ({
      email: p.email,
      firstName: p.first_name,
      lastName: p.last_name,
      fullName: p.full_name,
      title: p.title,
      seniority: (p.seniority || "").toLowerCase(),
      phone: p.phone,
      linkedin: p.linkedin,
      location: p.country,
      countryCode: p.country_code || p.country,
      company: {
        name: input.companyName,
        domain: domain,
        website: input.website,
        source: "instantly",
      },
      source: this.id,
      confidence: 0.6,
    }));

    return { vendor: this.id, contacts };
  }
}

class GenericWebhookVendor implements Vendor {
  id = "generic-webhook";
  isEnabled() {
    return !!process.env.CONTACTS_WEBHOOK_URL;
  }
  async findCompanyContacts(input: ResolveContactsInput): Promise<VendorResult> {
    const url = process.env.CONTACTS_WEBHOOK_URL!;
    const res = await withTimeout(fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CONTACTS_WEBHOOK_TOKEN ?? ""}` },
      body: JSON.stringify({ action: "findCompanyContacts", input }),
    }), 15000, "webhook vendor");
    if (!res.ok) return { vendor: this.id, contacts: [] };
    const data = await res.json();
    const contacts: ContactRecord[] = (data?.contacts ?? []).map((c: any) => ({
      ...c,
      source: c.source ?? this.id,
      confidence: c.confidence ?? 0.5,
    }));
    return { vendor: this.id, contacts };
  }
}

// -------------------- Resolver --------------------

export class ContactsResolver {
  private vendors: Vendor[];
  private compliance = new Compliance();

  constructor(opts?: { include?: string[]; exclude?: string[] }) {
    const all: Vendor[] = [
      new ApolloVendor(),
      new ClearbitVendor(),
      new InstantlyVendor(),
      new GenericWebhookVendor(),
    ];
    let enabled = all.filter((v) => v.isEnabled());
    if (opts?.include?.length) enabled = enabled.filter((v) => opts.include!.includes(v.id));
    if (opts?.exclude?.length) enabled = enabled.filter((v) => !opts.exclude!.includes(v.id));
    this.vendors = enabled;
  }

  async resolve(input: ResolveContactsInput): Promise<ContactRecord[]> {
    // Gate by plan: restrict vendors for free tier
    const plan = input.plan ?? "free";
    const cacheKey = computeCacheKey(input);
    const cached = cache.get(cacheKey);
    if (cached) {
      const merged = this.mergeAndFilter(cached, input);
      return this.postComplianceFilter(merged);
    }

    const vendorsToUse = this.vendors.filter((v) => this.isVendorAllowed(v.id, plan));
    if (!vendorsToUse.length) return [];

    const results = await Promise.allSettled(vendorsToUse.map((v) => v.findCompanyContacts(input)));
    const ok = results
      .filter((r): r is PromiseFulfilledResult<VendorResult> => r.status === "fulfilled")
      .map((r) => r.value);

    cache.set(cacheKey, ok);

    const merged = this.mergeAndFilter(ok, input);
    return this.postComplianceFilter(merged);
  }

  private isVendorAllowed(vendorId: string, plan: PlanTier) {
    // Simple gating logic; customize per your pricing
    const PRO_OK = ["apollo", "clearbit", "instantly", "generic-webhook"];
    const FREE_OK = ["generic-webhook"]; // keep free minimal to control costs
    const SCALE_OK = PRO_OK;

    if (plan === "free") return FREE_OK.includes(vendorId);
    if (plan === "pro") return PRO_OK.includes(vendorId);
    if (plan === "scale") return SCALE_OK.includes(vendorId);
    return false;
  }

  private mergeAndFilter(vendorResults: VendorResult[], input: ResolveContactsInput): ContactRecord[] {
    const lists = vendorResults.map((r) => r.contacts ?? []);
    let merged = mergeContacts(...lists);

    // Filter by country if requested
    const allowCountries = (input.countryIn ?? DEFAULT_COUNTRIES).map((c) => c.toUpperCase());
    merged = merged.filter((c) => {
      if (!allowCountries.length) return true;
      const cc = (c.countryCode || c.location || "").toUpperCase();
      return allowCountries.some((x) => cc.includes(x));
    });

    // Exclude generic emails if requested
    if (input.excludeGeneric ?? true) {
      merged = merged.filter((c) => !isGenericEmail(c.email));
    }

    // Prefer direct emails if requested; stable sort by that predicate
    if (input.preferDirect ?? true) {
      merged = [...merged].sort((a, b) => {
        const ad = a.email && !isGenericEmail(a.email) ? 1 : 0;
        const bd = b.email && !isGenericEmail(b.email) ? 1 : 0;
        return bd - ad;
      });
    }

    // Rank
    merged = rankContacts(merged, input);
    // Cap
    merged = merged.slice(0, Math.min(50, input.maxResults ?? 20));
    return merged;
  }

  private async postComplianceFilter(contacts: ContactRecord[]): Promise<ContactRecord[]> {
    // Check platform-wide DNC/Consent
    const out: ContactRecord[] = [];
    for (const c of contacts) {
      const emailOk = await this.compliance.isEmailAllowed(c.email ?? "");
      const domainOk = await this.compliance.isDomainAllowed(c.company?.domain ?? "");
      if (emailOk && domainOk) out.push(c);
    }
    return out;
  }
}

// -------------------- Convenience --------------------

export async function resolveCompanyContacts(input: ResolveContactsInput): Promise<ContactRecord[]> {
  const resolver = new ContactsResolver();
  return resolver.resolve(input);
}
