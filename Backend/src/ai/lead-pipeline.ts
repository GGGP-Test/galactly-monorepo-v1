/* 
  Lead Pipeline: fetch -> extract signals -> match -> guard -> score.
  - FREE mode uses local HTML heuristics + local embeddings (via ai-registry).
  - PRO mode can swap in paid enrichers/search providers without changing callers.

  How to use:
    import { searchAndScoreLeads } from "./lead-pipeline";
    const out = await searchAndScoreLeads({
      userId: "u_123",
      userCategories: ["stretch_wrap", "tape"],
      strategy: { mode: "FREE", speed: "balanced" },
      seeds: [
        { name: "Acme Snacks", domain: "https://acmesnacks.com" },
        { name: "Brava Beauty", domain: "https://bravabeauty.com" },
      ],
    });
*/

import { LeadFeatures, PackagingCategory, Channel, DEFAULT_WEIGHTS, UserWeights, clamp01 } from "./lead-features";
import { guardLeadSize, DEFAULT_GUARD } from "./lead-guard";
import { scoreLead, LeadScore } from "./lead-scoring";
import { getAIRegistry } from "./ai-registry";
import { detectTechAndDemand } from "./site-signals";

import * as cheerio from "cheerio";

// ---------- Public API ----------

export interface PipelineSeed {
  name: string;
  domain: string; // full URL is okay
  // Optional hints to bias inference and save time:
  country?: string;
  state?: string;
  city?: string;
  notes?: string;
}

export interface Strategy {
  mode?: "FREE" | "PRO";
  speed?: "fast" | "balanced" | "thorough";  // affects crawl depth/timeouts
  weights?: UserWeights;                      // UI sliders
  allowBigBuyers?: boolean;                   // true: we may consider large BRANDS (buyers)
}

export interface PipelineInput {
  userId: string;
  userCategories: PackagingCategory[]; // what the user sells
  seeds: PipelineSeed[];               // starting companies/domains
  strategy?: Strategy;
}

export interface ScoredLead {
  features: LeadFeatures;
  score: LeadScore;
  guard: { allowed: boolean; reason?: string };
  contacts: ContactGuess;
  explain: Badge[];
}

export interface PipelineOutput {
  leads: ScoredLead[];
  meta: {
    mode: "FREE" | "PRO";
    speed: Strategy["speed"];
    totalProcessed: number;
    totalAllowed: number;
  };
}

// ---------- Internal types ----------

type Badge = { label: string; detail?: string };
type ContactGuess = {
  emails: string[];
  phones: string[];
  social: Partial<Record<"linkedin"|"instagram"|"tiktok"|"x", string>>;
  contactPages: string[];
  reachableChannels: Channel[];
  bestChannel: Channel | null;
  responseLikelihood: number; // 0..1
};

// Categories -> short natural prompts for embedding similarity:
const CATEGORY_PROMPTS: Record<PackagingCategory, string> = {
  corrugated_boxes: "corrugated shipping boxes, cartons, box packaging",
  stretch_wrap: "stretch wrap film, pallet wrapping, hand wrap, machine wrap",
  poly_mailers: "poly mailers, shipping mailer bags, envelopes",
  tape: "packaging tape, carton sealing tape, adhesive tape",
  void_fill: "void fill, packing peanuts, air pillows, paper void fill",
  labels: "labels, shipping labels, barcode labels, stickers",
  custom_print: "custom printed packaging, branded boxes, custom mailers",
  sustainable: "eco-friendly packaging, recycled packaging, compostable mailers",
};

// ---------- Main Orchestration ----------

export async function searchAndScoreLeads(input: PipelineInput): Promise<PipelineOutput> {
  const { seeds, userCategories } = input;
  const strategy: Required<Strategy> = {
    mode: process.env.PRO_AI === "1" ? "PRO" : "FREE",
    speed: "balanced",
    weights: DEFAULT_WEIGHTS,
    allowBigBuyers: true,
    ...(input.strategy || {}),
  };

  const ai = await getAIRegistry(); // embeds, rerankers (FREE or PRO)
  const budget = speedToBudget(strategy.speed);

  const results: ScoredLead[] = [];
  let processed = 0;

  for (const seed of seeds) {
    try {
      // 1) Fetch primary page (and maybe one contact/about page)
      const pages = await fetchSiteBundle(seed.domain, budget);

      // 2) Extract text + signals
      const mainHTML = pages.htmlByUrl.get(pages.canonical) || "";
      const { tech, demand } = detectTechAndDemand(mainHTML);

      const core = inferFirmographics(seed, mainHTML); // lightweight guessers
      const behavior = inferBehavior(mainHTML, pages.allText);
      const contacts = extractContacts(seed.domain, pages);

      // 3) Infer packaging categories from site text using local embeddings (FREE)
      const categoriesNeeded = await inferCategories(ai, pages.allText, budget);
      const categoriesOverlap = jaccard(categoriesNeeded, userCategories);

      // 4) Assemble features
      const features: LeadFeatures = {
        core,
        demand: {
          ...demand,
          // if traffic-like cues present in text, bump proxy slightly
          orderVolumeProxy: Math.max(0, Math.min(1, behavior.trafficProxy ?? 0)),
        },
        tech,
        match: {
          categoriesNeeded,
          categoriesOverlap,
          priceBandFit: behavior.priceTierFit ?? 0.5,
          moqFit: behavior.moqFit ?? 0.5,
          leadTimeFit: behavior.leadTimeFit ?? 0.5,
        },
        behavior: {
          postsPerWeek: behavior.postsPerWeek,
          responseLikelihood: contacts.responseLikelihood,
          reviewVolume: behavior.reviewVolume,
          reviewSentiment: behavior.reviewSentiment,
          referralLikelihood: behavior.referralLikelihood,
          vendorChurnHistory: behavior.vendorChurnHistory,
        },
        platform: {
          reachableChannels: contacts.reachableChannels,
          bestChannel: contacts.bestChannel,
        },
      };

      // 5) Guard out too-large packaging suppliers (and optionally mega corps)
      const guard = guardLeadSize(features, DEFAULT_GUARD);
      if (!guard.allowed && !(strategy.allowBigBuyers && !core.isPackagingSupplier)) {
        processed += 1;
        continue;
      }

      // 6) Score
      const score = scoreLead(features, strategy.weights);

      // 7) Explain badges
      const explain = makeBadges(features, score);

      results.push({ features, score, guard, contacts, explain });
      processed += 1;
    } catch (err) {
      processed += 1;
      // swallow per-seed errors; you can log to your observability here
    }
  }

  // Sort: HOT first, then by total score
  results.sort((a, b) => {
    if (a.score.label !== b.score.label) return a.score.label === "HOT" ? -1 : 1;
    return b.score.total100 - a.score.total100;
  });

  return {
    leads: results,
    meta: {
      mode: ai.mode,
      speed: strategy.speed,
      totalProcessed: processed,
      totalAllowed: results.length,
    },
  };
}

// ---------- Fetching ----------

interface SiteBundle {
  canonical: string;
  htmlByUrl: Map<string, string>;
  allText: string; // concatenated
}

function speedToBudget(speed: Strategy["speed"]) {
  switch (speed) {
    case "fast": return { maxPages: 1, timeoutMs: 4000 };
    case "thorough": return { maxPages: 5, timeoutMs: 12000 };
    default: return { maxPages: 2, timeoutMs: 7000 };
  }
}

async function fetchSiteBundle(url: string, budget: { maxPages: number; timeoutMs: number }): Promise<SiteBundle> {
  const toVisit = new Set<string>();
  const visited = new Set<string>();
  const htmlByUrl = new Map<string, string>();

  const canon = normalizeUrl(url);
  toVisit.add(canon);

  const contactRegex = /(contact|about|customer\-service|support)/i;

  while (toVisit.size && visited.size < budget.maxPages) {
    const next = Array.from(toVisit)[0];
    toVisit.delete(next);
    visited.add(next);

    const html = await safeFetch(next, budget.timeoutMs);
    if (!html) continue;
    htmlByUrl.set(next, html);

    // try to queue a contact/about page once
    const $ = cheerio.load(html);
    if (visited.size < budget.maxPages) {
      $("a[href]").each((_, el) => {
        const href = String($(el).attr("href") || "");
        if (contactRegex.test(href)) {
          const abs = absolutize(canon, href);
          if (abs && !visited.has(abs)) toVisit.add(abs);
        }
      });
    }
  }

  const allText = Array.from(htmlByUrl.values()).map(stripText).join("\n");
  return { canonical: canon, htmlByUrl, allText };
}

async function safeFetch(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": ua() } as any });
    clearTimeout(t);
    if (!res.ok) return null;
    const text = await res.text();
    return text;
  } catch {
    return null;
  }
}

const ua = () =>
  `Mozilla/5.0 (compatible; LeadScout/1.0; +https://example.com/bot)`;

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    if (!url.pathname || url.pathname === "/") return url.origin;
    return url.toString();
  } catch {
    return u;
  }
}

function absolutize(baseUrl: string, href: string): string | null {
  try {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

// ---------- Extraction & Inference ----------

function stripText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function inferFirmographics(seed: PipelineSeed, mainHTML: string): LeadFeatures["core"] {
  const text = stripText(mainHTML).toLowerCase();

  // Heuristics to guess if they are a packaging supplier (sell packaging)
  const sellsPackaging = /(packaging|boxes|mailers|void fill|bubble wrap|stretch wrap|corrugated)/i.test(text);
  const isEcom = /(add to cart|checkout|cart)/i.test(mainHTML);

  // Very rough revenue/employee estimates: leave empty by default in FREE mode
  const revenueUSD = undefined;
  const employees = undefined;

  return {
    id: seed.domain,
    name: seed.name,
    domain: seed.domain,
    country: seed.country,
    state: seed.state,
    city: seed.city,
    naics: [],
    isPackagingSupplier: sellsPackaging && isEcom,
    revenueUSD,
    employees,
  };
}

function inferBehavior(mainHTML: string, allText: string) {
  const $ = cheerio.load(mainHTML);
  const txt = allText.toLowerCase();

  const blogPosts = (txt.match(/posted on|read more|comments?\b/g) || []).length;
  const postsPerWeek = Math.min(5, blogPosts / 20); // naive proxy

  const reviewVolume =
    (txt.match(/\b(review|reviews|rating|ratings)\b/g) || []).length;

  const reviewSentiment = /5 stars|excellent|great|love/i.test(allText) ? 0.75 :
                          /bad|terrible|awful|1 star/i.test(allText) ? 0.25 : 0.5;

  const referralLikelihood = /refer|referral|affiliate|ambassador/i.test(allText) ? 0.7 : 0.4;

  const vendorChurnHistory = 0.4; // neutral prior until enriched

  const priceTierFit = /premium|luxury/i.test(allText) ? 0.3 :
                       /discount|wholesale|bulk/i.test(allText) ? 0.8 : 0.5;

  const moqFit = /no minimum|low moq/i.test(allText) ? 0.8 : /high minimum|bulk only/i.test(allText) ? 0.3 : 0.5;

  const leadTimeFit = /same day|next day|fast shipping|quick turnaround/i.test(allText) ? 0.8 :
                      /backorder|preorder|made to order/i.test(allText) ? 0.4 : 0.5;

  const trafficProxy = /add to cart|checkout|bestseller|top seller|order now/i.test(allText) ? 0.7 : 0.45;

  return {
    postsPerWeek,
    reviewVolume,
    reviewSentiment,
    referralLikelihood,
    vendorChurnHistory,
    priceTierFit,
    moqFit,
    leadTimeFit,
    trafficProxy,
  };
}

function extractContacts(baseUrl: string, pages: SiteBundle): ContactGuess {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials: ContactGuess["social"] = {};
  const contactPages: string[] = [];

  for (const [url, html] of pages.htmlByUrl) {
    const $ = cheerio.load(html);
    const text = $.text();

    // emails
    const emailMatches = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
    emailMatches.forEach((e) => emails.add(e.toLowerCase()));

    // phones (simple)
    const phoneMatches = text.match(/(\+?\d[\d\-\s\(\)]{8,}\d)/g) || [];
    phoneMatches.forEach((p) => phones.add(p.trim()));

    // contact pages
    $("a[href]").each((_, el) => {
      const href = String($(el).attr("href") || "");
      if (/(contact|support|customer\-service)/i.test(href)) {
        const abs = absolutize(baseUrl, href);
        if (abs) contactPages.push(abs);
      }
      if (/linkedin\.com\//i.test(href)) socials.linkedin = href;
      if (/instagram\.com\//i.test(href)) socials.instagram = href;
      if (/tiktok\.com\//i.test(href)) socials.tiktok = href;
      if (/twitter\.com\/|x\.com\//i.test(href)) socials.x = href;
    });
  }

  const reachable: Channel[] = [];
  if (emails.size) reachable.push("email");
  if (contactPages.length) reachable.push("website_form");
  if (phones.size) reachable.push("phone");
  if (socials.linkedin) reachable.push("linkedin");
  if (socials.instagram) reachable.push("instagram");
  if (socials.tiktok) reachable.push("tiktok");
  if (socials.x) reachable.push("x");

  // Heuristic response likelihood
  let base = 0.35;
  if (emails.size) base += 0.20;
  if (contactPages.length) base += 0.15;
  if (phones.size) base += 0.10;
  if (socials.linkedin) base += 0.10;
  const responseLikelihood = Math.min(1, base);

  // Pick best channel
  const best =
    emails.size ? "email" :
    contactPages.length ? "website_form" :
    socials.linkedin ? "linkedin" :
    phones.size ? "phone" :
    socials.instagram ? "instagram" :
    socials.tiktok ? "tiktok" :
    socials.x ? "x" : null;

  return {
    emails: Array.from(emails),
    phones: Array.from(phones),
    social: socials,
    contactPages,
    reachableChannels: reachable,
    bestChannel: best,
    responseLikelihood,
  };
}

async function inferCategories(
  ai: Awaited<ReturnType<typeof getAIRegistry>>,
  siteText: string,
  budget: { maxPages: number; timeoutMs: number }
): Promise<PackagingCategory[]> {
  const snippets = sliceForEmbedding(siteText, 512, 10); // up to 10 chunks
  const [docEmb] = await Promise.all([ai.embed(snippets)]);

  // Embed prompts
  const promptKeys = Object.keys(CATEGORY_PROMPTS) as PackagingCategory[];
  const prompts = promptKeys.map((k) => CATEGORY_PROMPTS[k]);
  const promptEmb = await ai.embed(prompts);

  // Average doc embedding
  const meanDoc = meanVector(docEmb);

  // Cosine similarity with each category prompt
  const sims = promptEmb.map((pe) => cosine(meanDoc, pe));

  // Pick categories above threshold; keep top 3 at most
  const scored: Array<{ k: PackagingCategory; s: number }> = sims.map((s, i) => ({ k: promptKeys[i], s }));
  scored.sort((a, b) => b.s - a.s);

  const threshold = 0.35; // tuneable
  return scored.filter(x => x.s >= threshold).slice(0, 3).map(x => x.k);
}

// ---------- Helpers ----------

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  const inter = new Set([...A].filter(x => B.has(x)));
  const uni = new Set([...A, ...B]);
  return uni.size ? inter.size / uni.size : 0;
}

function sliceForEmbedding(text: string, tokensApprox = 512, maxSlices = 10): string[] {
  const words = text.split(/\s+/);
  const chunkSize = tokensApprox; // rough proxy
  const chunks: string[] = [];
  for (let i = 0; i < words.length && chunks.length < maxSlices; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
  }
  return chunks;
}

function meanVector(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const acc = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i] += v[i];
  return acc.map(x => x / vectors.length);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function makeBadges(f: LeadFeatures, score: LeadScore): Badge[] {
  const out: Badge[] = [];

  if (score.label === "HOT") out.push({ label: "🔥 Hot fit" });
  if (f.demand.adsActive) out.push({ label: "Running ads", detail: (f.demand.adChannels || []).join(", ") });
  if (f.demand.checkoutDetected) out.push({ label: "Has checkout" });
  if ((f.platform.reachableChannels || []).length) out.push({ label: "Reachable", detail: f.platform.reachableChannels.join(", ") });
  if (f.match.categoriesOverlap >= 0.5) out.push({ label: "Strong product match" });

  // Top driving columns from scoring:
  score.topFactors.forEach(k => out.push({ label: `Boost: ${prettyCol(k)}` }));

  return out.slice(0, 6);
}

function prettyCol(k: string): string {
  switch (k) {
    case "intent": return "Intent";
    case "stay": return "Stickiness";
    case "character": return "Goodwill";
    case "platform": return "Reply odds";
    default: return k;
  }
}
