// src/ai/providers/enrichment.ts

/**
 * Pluggable company enrichment that maps external signals into LeadFeatures.
 * - FREE: HTML heuristics only (no external APIs).
 * - PRO: Optional paid APIs if keys are present (Clearbit, PDL, Wappalyzer-like).
 *
 * No provider is required at runtime; getEnricher() will pick the best available.
 */

import type { LeadFeatures } from "../lead-features";

export type EnrichmentMode = "FREE" | "PRO";

export interface EnrichmentInput {
  name?: string;
  domain: string; // full URL OK
  country?: string;
  state?: string;
  city?: string;
}

export interface EnrichedData {
  core?: Partial<LeadFeatures["core"]>;
  demand?: Partial<LeadFeatures["demand"]>;
  tech?: Partial<LeadFeatures["tech"]>;
  behavior?: Partial<LeadFeatures["behavior"]>;
  platform?: Partial<LeadFeatures["platform"]>;
  raw?: Record<string, unknown>; // provider raw payloads for debugging
}

export interface EnrichmentProvider {
  id: string;
  mode: EnrichmentMode;
  enrich(input: EnrichmentInput): Promise<EnrichedData>;
}

// ------------------------- Public API ---------------------------------------

export function getEnricher(): EnrichmentProvider {
  // If any PRO keys are present, prefer PRO enricher
  const hasClearbit = !!process.env.CLEARBIT_KEY;
  const hasPDL = !!process.env.PDL_API_KEY;
  const hasWappalyzer = !!process.env.WAPPALYZER_KEY;

  if (hasClearbit || hasPDL || hasWappalyzer) {
    return new ProEnricher({ clearbit: hasClearbit, pdl: hasPDL, wappalyzer: hasWappalyzer });
  }
  return new FreeEnricher();
}

/** Merge shallow enrichment into an existing LeadFeatures object. */
export function applyEnrichment(base: LeadFeatures, patch: EnrichedData): LeadFeatures {
  return {
    ...base,
    core: { ...base.core, ...(patch.core || {}) },
    demand: { ...base.demand, ...(patch.demand || {}) },
    tech: { ...base.tech, ...(patch.tech || {}) },
    behavior: { ...base.behavior, ...(patch.behavior || {}) },
    platform: { ...base.platform, ...(patch.platform || {}) },
  };
}

// ------------------------- FREE Provider ------------------------------------

class FreeEnricher implements EnrichmentProvider {
  id = "free-html";
  mode: EnrichmentMode = "FREE";

  async enrich(input: EnrichmentInput): Promise<EnrichedData> {
    const url = normalize(input.domain);
    const html = await safeFetch(url, 6000);
    if (!html) return {};

    const text = strip(html);
    const meta = extractMeta(html);

    // Demand cues
    const adsActive = /\bgoogle ads\b|\bmeta ads\b|\badvertise with us\b/i.test(text) || /gtag\(/i.test(html);
    const adChannels = detectAdTags(html);

    const checkoutDetected = /add to cart|checkout|cart|woocommerce|shopify|snipcart/i.test(html);
    const marketplaces: string[] = [];
    if (/shopify\.cdn|cdn\.shopify|x-shopify/i.test(html)) marketplaces.push("shopify");
    if (/woocommerce|wp\-content\/plugins\/woocommerce/i.test(html)) marketplaces.push("woocommerce");
    if (/bigcommerce|stencil-utils/i.test(html)) marketplaces.push("bigcommerce");
    if (/swell\.is|commercetools|saleor/i.test(html)) marketplaces.push("other_ecom");

    // Tech cues (very light)
    const usesGA = /www\.googletagmanager\.com|gtag\(/i.test(html);
    const usesMetaPixel = /connect\.facebook\.net\/.+\/fbevents\.js/i.test(html);
    const cdn = /cloudfront\.net|cloudflare|fastly|akamai/i.test(html) ? "major_cdn" : undefined;

    // Behavior proxies
    const reviewVolume = (text.match(/\breview(s)?\b/gi) || []).length;
    const postsPerWeek = Math.min(5, (text.match(/\bblog\b/gi) || []).length / 20);
    const referralLikelihood = /refer|referral|affiliate|ambassador/i.test(text) ? 0.7 : 0.4;

    // Platform reachability (links)
    const links = extractLinks(html, url);
    const reachableChannels = links.channels;
    const bestChannel = links.best;
    const responseLikelihood = 0.3 + (reachableChannels.includes("email") ? 0.2 : 0) + (reachableChannels.includes("website_form") ? 0.15 : 0);

    return {
      demand: {
        adsActive,
        adChannels,
        checkoutDetected,
        marketplaces,
      },
      tech: {
        analytics: usesGA ? ["google_analytics"] : [],
        pixels: usesMetaPixel ? ["meta_pixel"] : [],
        cdn,
      },
      behavior: {
        reviewVolume,
        postsPerWeek,
        referralLikelihood,
      },
      platform: {
        reachableChannels,
        bestChannel,
      },
      raw: { meta },
    };
  }
}

// ------------------------- PRO Provider -------------------------------------

type ProEnricherDeps = { clearbit?: boolean; pdl?: boolean; wappalyzer?: boolean };

class ProEnricher implements EnrichmentProvider {
  id = "pro-multi";
  mode: EnrichmentMode = "PRO";
  deps: ProEnricherDeps;
  constructor(deps: ProEnricherDeps) { this.deps = deps; }

  async enrich(input: EnrichmentInput): Promise<EnrichedData> {
    const url = normalize(input.domain);

    const [cb, pdl, wap] = await Promise.allSettled([
      this.deps.clearbit ? this.fetchClearbit(url) : Promise.resolve(null),
      this.deps.pdl ? this.fetchPDL(url) : Promise.resolve(null),
      this.deps.wappalyzer ? this.fetchWappalyzer(url) : Promise.resolve(null),
    ]);

    const raw: Record<string, unknown> = {};
    const out: EnrichedData = {};

    // Clearbit -> firmographics
    if (cb.status === "fulfilled" && cb.value) {
      raw.clearbit = cb.value;
      const c = cb.value as any;
      out.core = {
        revenueUSD: num(c?.metrics?.estimatedAnnualRevenue),
        employees: num(c?.metrics?.employees),
        country: c?.geo?.country,
        state: c?.geo?.state,
        city: c?.geo?.city,
        naics: Array.isArray(c?.category?.naics) ? c.category.naics : [],
      };
      out.demand = { orderVolumeProxy: clamp01Num(c?.metrics?.estimatedAnnualRevenue ? Math.log10(c.metrics.estimatedAnnualRevenue) / 10 : 0.5) };
    }

    // PDL -> size, socials
    if (pdl.status === "fulfilled" && pdl.value) {
      raw.pdl = pdl.value;
      const c = pdl.value as any;
      out.core = { ...(out.core || {}), employees: out.core?.employees ?? num(c?.employee_count) };
      out.platform = {
        reachableChannels: uniq([
          ...(c?.linkedin_url ? ["linkedin"] : []),
          ...(c?.twitter_url ? ["x"] : []),
          ...(c?.facebook_url ? ["instagram"] : []),
        ]),
      };
    }

    // Wappalyzer -> tech stack + checkout cues
    if (wap.status === "fulfilled" && wap.value) {
      raw.wappalyzer = wap.value;
      const apps: string[] = Array.isArray((wap.value as any)?.applications)
        ? (wap.value as any).applications.map((x: any) => x.name?.toLowerCase?.()).filter(Boolean)
        : [];
      const marketplaces = [];
      if (apps.some(a => a.includes("shopify"))) marketplaces.push("shopify");
      if (apps.some(a => a.includes("woocommerce"))) marketplaces.push("woocommerce");
      if (apps.some(a => a.includes("bigcommerce"))) marketplaces.push("bigcommerce");
      out.demand = { ...(out.demand || {}), marketplaces, checkoutDetected: marketplaces.length > 0 };
      out.tech = { ...(out.tech || {}), analytics: apps.filter(a => a.includes("analytics")) };
    }

    out.raw = raw;
    return out;
  }

  private async fetchClearbit(domain: string) {
    const key = process.env.CLEARBIT_KEY!;
    const d = hostname(domain);
    const res = await fetch(`https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(d)}`, {
      headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
    });
    if (!res.ok) return null;
    return res.json();
  }

  private async fetchPDL(domain: string) {
    const key = process.env.PDL_API_KEY!;
    const d = hostname(domain);
    const res = await fetch("https://api.peopledatalabs.com/v5/company/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify({ website: d }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  private async fetchWappalyzer(domain: string) {
    const key = process.env.WAPPALYZER_KEY!;
    const d = normalize(domain);
    const res = await fetch("https://api.wappalyzer.com/v2/lookup/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify([{ url: d }]),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? json[0] : json;
  }
}

// ------------------------- Utils --------------------------------------------

function normalize(u: string) {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  } catch {
    return `https://${u}`; // naive fallback
  }
}
function hostname(u: string) {
  try { return new URL(u).hostname; } catch { return u.replace(/^https?:\/\//, ""); }
}
async function safeFetch(url: string, timeoutMs: number) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA } as any });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}
const UA = "Mozilla/5.0 (compatible; LeadScout/1.0; enrichment)";

function strip(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
             .replace(/<style[\s\S]*?<\/style>/gi, "")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ")
             .trim();
}
function extractMeta(html: string) {
  const meta: Record<string, string> = {};
  const tagRe = /<meta\s+([^>]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const attrs = m[1];
    const name = /(?:name|property|itemprop)=["']([^"']+)["']/i.exec(attrs)?.[1];
    const content = /content=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (name && content) meta[name.toLowerCase()] = content;
  }
  return meta;
}
function detectAdTags(html: string): string[] {
  const out = new Set<string>();
  if (/googletagmanager\.com|gtag\(/i.test(html)) out.add("google_ads/ga");
  if (/googleads\.g\.doubleclick\.net/i.test(html)) out.add("google_ads");
  if (/connect\.facebook\.net\/.+\/fbevents\.js/i.test(html)) out.add("meta_ads");
  if (/snap\.sc\/sdk/i.test(html)) out.add("snap_ads");
  if (/tiktok\.com\/tag/i.test(html)) out.add("tiktok_ads");
  return Array.from(out);
}
function extractLinks(html: string, base: string) {
  const linkRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const emails = new Set<string>();
  const channels: Array<NonNullable<LeadFeatures["platform"]>["reachableChannels"][number]> = [];
  const contactPages: string[] = [];
  let best: LeadFeatures["platform"]["bestChannel"] = null;

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const href = m[1];
    if (/mailto:/i.test(href)) {
      const email = href.replace(/mailto:/i, "").trim().toLowerCase();
      if (email) emails.add(email);
    }
    if (/contact|support|customer\-service/i.test(href)) {
      contactPages.push(abs(base, href));
    }
    if (/linkedin\.com\//i.test(href)) if (!channels.includes("linkedin")) channels.push("linkedin");
    if (/instagram\.com\//i.test(href)) if (!channels.includes("instagram")) channels.push("instagram");
    if (/tiktok\.com\//i.test(href)) if (!channels.includes("tiktok")) channels.push("tiktok");
    if (/twitter\.com\/|x\.com\//i.test(href)) if (!channels.includes("x")) channels.push("x");
  }
  if (emails.size) channels.unshift("email");
  if (contactPages.length && !channels.includes("website_form")) channels.push("website_form");
  best = emails.size ? "email" : (contactPages.length ? "website_form" : (channels[0] || null));

  return { channels, best, emails: Array.from(emails), contactPages };
}
function abs(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return href; }
}
function num(x: any): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}
function clamp01Num(x: any) {
  const n = num(x);
  if (n == null) return 0.5;
  return Math.max(0, Math.min(1, n));
}
function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }
