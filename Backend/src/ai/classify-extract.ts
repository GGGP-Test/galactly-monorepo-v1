// src/ai/classify-extract.ts
/**
 * classify-extract.ts — company profile extraction & vertical classification
 *
 * Modes:
 *  - Heuristics (fast, free): keyword rules & lightweight patterns
 *  - LLM (paid or when available): routes to configured LLM provider(s)
 *  - Ensemble: blend heuristics + LLM with confidence arbitration
 */

export interface CompanyProfile {
  domain: string;
  url?: string;
  name?: string;
  title?: string;
  description?: string;
  keywords?: string[];
  emails?: string[];
  phones?: string[];
  socials?: Record<string, string>;
  locations?: string[];
  sizeHint?: "solo" | "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+";
  meta?: Record<string, any>;
}

export interface Classification {
  label: string;                 // chosen vertical
  confidence: number;            // 0..1
  candidates?: Array<{ label: string; confidence: number }>;
  method: "heuristics" | "llm" | "ensemble";
  rationale?: string;
}

export interface ExtractOptions {
  stripScripts?: boolean;
  maxTextLen?: number;
}

export interface ClassifyOptions {
  taxonomy?: string[];           // allowed labels; defaults to PACKAGING_BUYER_TAXONOMY
  useLLM?: boolean;
  llm?: LLMRouter;
  minLLMConfidence?: number;     // default 0.6
}

export interface LLMRouter {
  // Returns best label among candidates with a confidence 0..1 and optional rationale
  classify(input: string, labels: string[]): Promise<{ label: string; confidence: number; rationale?: string }>;
  name(): string;
}

// -------------------------- Extraction ---------------------------

export function extractCompanyProfile(html: string, urlOrDomain: string, opts: ExtractOptions = {}): CompanyProfile {
  const clean = sanitizeHtml(html, opts);
  const text = truncate(toText(clean), opts.maxTextLen ?? 35000);
  const title = extractTitle(html);
  const name = extractSiteName(html) || hostPart(urlOrDomain);
  const desc = extractMetaDescription(html);
  const emails = (Array.from(text.matchAll(EMAIL_RE)).map(m => m[0]).slice(0, 10));
  const phones = (Array.from(text.matchAll(PHONE_RE)).map(n => normalizePhone(n[0])).filter(Boolean) as string[]).slice(0, 10);
  const socials = extractSocials(html);
  const keywords = extractKeywords(text, desc);
  const locations = guessLocations(text);
  const sizeHint = guessSize(text);

  return {
    domain: hostPart(urlOrDomain),
    url: ensureUrl(urlOrDomain),
    name,
    title,
    description: desc,
    keywords,
    emails: dedupe(emails),
    phones: dedupe(phones),
    socials,
    locations,
    sizeHint,
    meta: {
      hasShopify: /cdn\.shopify\.com|x-shopify/i.test(html),
      hasWoo: /woocommerce|wp-content\/plugins\/woocommerce/i.test(html),
    },
  };
}

// ------------------------ Classification -------------------------

export const PACKAGING_BUYER_TAXONOMY: string[] = [
  "food_and_beverage",
  "meal_kits_and_d2c_food",
  "cosmetics_and_personal_care",
  "nutraceuticals_and_supplements",
  "household_and_cleaning",
  "pet_care",
  "apparel_and_accessories",
  "electronics_accessories",
  "industrial_mro_and_parts",
  "home_and_garden",
  "healthcare_pharma_otc",
  "baby_and_maternity",
  "office_and_stationery",
  "automotive_aftermarket",
  "sports_and_outdoors",
  "beverages_alcohol_free",
  "beverages_alcoholic",
  "cannabis_and_cbd",
  "hardware_tools",
  "books_media_and_edu",
  "furniture_and_home_goods",
  "arts_and_crafts",
  "toys_and_games",
  "grocery_and_convenience",
  "bakery_and_confectionery",
  "coffee_and_tea",
  "beauty_salon_spa",
  "medical_devices_and_supplies",
  "chemicals_and_lab",
  "logistics_and_3pl",
];

export async function classifyVertical(profile: CompanyProfile, opts: ClassifyOptions = {}): Promise<Classification> {
  const taxonomy = opts.taxonomy && opts.taxonomy.length ? opts.taxonomy : PACKAGING_BUYER_TAXONOMY;
  const heur = classifyHeuristics(profile, taxonomy);

  // If LLM not requested or heuristics are strong, return heuristics
  const useLLM = !!opts.useLLM && !!opts.llm;
  if (!useLLM || heur.confidence >= 0.8) return { ...heur, method: "heuristics" };

  try {
    const llmIn = buildLLMPrompt(profile, taxonomy);
    const resp = await opts.llm!.classify(llmIn, taxonomy);
    const llmResult: Classification = {
      label: resp.label,
      confidence: clamp01(resp.confidence),
      method: "llm",
      rationale: resp.rationale,
      candidates: [ { label: heur.label, confidence: heur.confidence }, { label: resp.label, confidence: resp.confidence } ],
    };

    // Ensemble: if LLM and Heuristics agree -> boost; else pick higher confidence above threshold
    if (llmResult.label === heur.label) {
      return {
        label: heur.label,
        confidence: clamp01(Math.max(heur.confidence, llmResult.confidence) + 0.1),
        method: "ensemble",
        rationale: `Agreement between rules and ${opts.llm?.name()}`,
        candidates: [ { label: heur.label, confidence: heur.confidence }, { label: llmResult.label, confidence: llmResult.confidence } ],
      };
    }
    // disagreement: choose greater confidence if above min threshold
    const min = opts.minLLMConfidence ?? 0.6;
    const pickLLM = llmResult.confidence >= Math.max(heur.confidence + 0.05, min);
    return pickLLM ? { ...llmResult, method: "ensemble", rationale: `LLM overrode rules (${opts.llm?.name()})` } : { ...heur, method: "ensemble", rationale: "Rules held (LLM under threshold)" };
  } catch {
    // fallback to heuristics
    return { ...heur, method: "heuristics" };
  }
}

// ------------------- Heuristic classifier ------------------------

function classifyHeuristics(profile: CompanyProfile, taxonomy: string[]): Classification {
  const text = ((profile.title || "") + " " + (profile.description || "") + " " + (profile.keywords || []).join(" ")).toLowerCase();
  const keys = new Set((profile.keywords || []).map(k => k.toLowerCase()));

  const score = (label: string, pts: number) => ({ label, confidence: clamp01(pts) });

  // rule helpers
  const has = (re: RegExp) => re.test(text);
  const kHas = (kw: string | RegExp) => (typeof kw === "string" ? keys.has(kw) : kw.test(Array.from(keys).join(" ")));

  const candidates: Array<{ label: string; confidence: number }> = [];

  if (has(/\b(energy drink|soda|juice|beverage|bottled water|kombucha|sparkling)\b/)) candidates.push(score("beverages_alcohol_free", 0.8));
  if (has(/\b(beer|brewery|wine|distillery|spirits)\b/)) candidates.push(score("beverages_alcoholic", 0.85));
  if (has(/\b(meal kit|ready[-\s]?to[-\s]?eat|frozen meals|prepared meals)\b/)) candidates.push(score("meal_kits_and_d2c_food", 0.85));
  if (has(/\b(coffee|roastery|tea|matcha|k-cup)\b/)) candidates.push(score("coffee_and_tea", 0.8));
  if (has(/\b(chocolate|candy|confection|bakery|cookies|baked goods)\b/)) candidates.push(score("bakery_and_confectionery", 0.8));
  if (has(/\b(supplement|vitamin|gummy|protein|preworkout|collagen)\b/)) candidates.push(score("nutraceuticals_and_supplements", 0.9));
  if (has(/\b(cosmetic|skincare|lipstick|serum|lotion|fragrance|makeup)\b/)) candidates.push(score("cosmetics_and_personal_care", 0.9));
  if (has(/\b(pet food|dog treats|cat litter|pet shampoo)\b/)) candidates.push(score("pet_care", 0.8));
  if (has(/\b(detergent|cleaner|dish soap|laundry|household)\b/)) candidates.push(score("household_and_cleaning", 0.75));
  if (has(/\b(apparel|streetwear|t-shirt|hoodie|boutique|fashion)\b/)) candidates.push(score("apparel_and_accessories", 0.7));
  if (has(/\b(vape|cbd|hemp|cannabis|edibles)\b/)) candidates.push(score("cannabis_and_cbd", 0.85));
  if (has(/\b(syringe|bandage|medical device|orthopedic|cpap|dme)\b/)) candidates.push(score("medical_devices_and_supplies", 0.8));
  if (has(/\b(lab chemical|reagent|solvent|MSDS|sds)\b/) || kHas(/msds|sds/)) candidates.push(score("chemicals_and_lab", 0.75));
  if (has(/\b(3pl|fulfillment|warehouse|logistics)\b/)) candidates.push(score("logistics_and_3pl", 0.65));
  if (has(/\b(hardware|fasteners|industrial|o-rings|bearings)\b/)) candidates.push(score("industrial_mro_and_parts", 0.75));
  if (has(/\b(stationery|office supplies|paper goods|envelope)\b/)) candidates.push(score("office_and_stationery", 0.7));
  if (has(/\b(grocery|convenience store|snacks)\b/)) candidates.push(score("grocery_and_convenience", 0.65));
  if (has(/\b(sofa|furniture|home decor|candle|diffuser)\b/)) candidates.push(score("furniture_and_home_goods", 0.65));
  if (has(/\b(arts|craft|scrapbook|yarn|knit)\b/)) candidates.push(score("arts_and_crafts", 0.65));
  if (has(/\b(toy|game|puzzle|action figure)\b/)) candidates.push(score("toys_and_games", 0.65));
  if (has(/\b(sports|fitness|supplement)\b/)) candidates.push(score("sports_and_outdoors", 0.6));
  if (has(/\b(garden|landscap|planter|soil|fertilizer)\b/)) candidates.push(score("home_and_garden", 0.6));
  if (has(/\b(baby|diaper|infant|maternity)\b/)) candidates.push(score("baby_and_maternity", 0.7));
  if (has(/\b(phone case|charger|electronics accessory)\b/)) candidates.push(score("electronics_accessories", 0.6));

  // boost by commerce signals inferred in meta
  let boost = 0;
  if (profile.meta?.hasShopify) boost += 0.05;
  if (profile.meta?.hasWoo) boost += 0.03;

  // choose best within allowed taxonomy
  const filtered = candidates.filter(c => taxonomy.includes(c.label));
  if (!filtered.length) {
    return { label: "industrial_mro_and_parts", confidence: 0.35 + boost, method: "heuristics", rationale: "Default fallback" };
  }
  // pick highest confidence and keep top 3 candidates
  filtered.sort((a, b) => b.confidence - a.confidence);
  const top = filtered[0];
  return {
    label: top.label,
    confidence: clamp01(top.confidence + boost),
    method: "heuristics",
    candidates: filtered.slice(0, 3),
    rationale: "Keyword rules",
  };
}

// --------------------------- LLM prompt --------------------------

function buildLLMPrompt(profile: CompanyProfile, taxonomy: string[]): string {
  const lines = [
    `Classify the company's primary buyer vertical for packaging procurement.`,
    `Return ONLY one best label from the provided labels.`,
    ``,
    `COMPANY:`,
    `- Domain: ${profile.domain}`,
    `- Name: ${profile.name || ""}`,
    `- Title: ${profile.title || ""}`,
    `- Description: ${profile.description || ""}`,
    `- Keywords: ${(profile.keywords || []).join(", ")}`,
    `- Socials: ${Object.keys(profile.socials || {}).join(", ")}`,
    ``,
    `LABELS: ${taxonomy.join(", ")}`,
  ];
  return lines.join("\n");
}

// ------------------------- LLM Routers ---------------------------

/**
 * Example stub LLM router; wire with your actual providers elsewhere.
 * Compatible with OpenAI/Anthropic/Grok client wrappers.
 */
export class SimpleLLMRouter implements LLMRouter {
  constructor(private readonly backend: (input: string, labels: string[]) => Promise<{label: string; confidence: number; rationale?: string}>, private readonly id = "llm-router") {}
  name() { return this.id; }
  classify(input: string, labels: string[]) { return this.backend(input, labels); }
}

// --------------------------- Helpers -----------------------------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s\-\.]?)?(?:\(?\d{3}\)?[\s\-\.]?)\d{3}[\s\-\.]?\d{4}/g;

function sanitizeHtml(html: string, opts: ExtractOptions): string {
  const stripScripts = opts.stripScripts !== false;
  let s = html || "";
  if (stripScripts) s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  return s;
}

function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string { return s.length > max ? s.slice(0, max) : s; }

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1]).trim().slice(0, 200) : undefined;
}

function extractSiteName(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
  if (og) return decode(og[1]).trim();
  const logoAlt = html.match(/<img[^>]+alt=["']([^"']*logo[^"']*)["']/i);
  if (logoAlt) return decode(logoAlt[1]).replace(/logo/i, "").trim();
  return undefined;
}

function extractMetaDescription(html: string): string | undefined {
  const m1 = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i);
  const m2 = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  const txt = decode((m1?.[1] || m2?.[1] || "")).trim();
  return txt ? txt.slice(0, 500) : undefined;
}

function extractSocials(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pairs: Array<[key: string, re: RegExp]> = [
    ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._\-]+/i],
    ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._\-]+/i],
    ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._\-]+/i],
    ["linkedin", /https?:\/\/(?:www\.)?linkedin\.com\/company\/[A-Za-z0-9._\-]+/i],
    ["twitter", /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9._\-]+/i],
    ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:c|channel|@)\/[A-Za-z0-9._\-]+/i],
  ];
  for (const [k, re] of pairs) {
    const m = html.match(re);
    if (m) out[k] = m[0];
  }
  return out;
}

function extractKeywords(text: string, desc?: string): string[] {
  const bag = (desc ? `${desc} ` : "") + text;
  const words = bag
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && w.length < 25);

  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const top = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([w]) => w);

  // add bigrams for packaging-relevant terms
  const grams = extractBigrams(text);
  return dedupe([...top, ...grams]);
}

function extractBigrams(text: string): string[] {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const bg = `${tokens[i]} ${tokens[i + 1]}`;
    if (BG_STOP.has(bg)) continue;
    if (/packag|bottle|jar|box|carton|pouch|mailer|label|insert/.test(bg)) out.push(bg);
  }
  return out.slice(0, 30);
}

function guessLocations(text: string): string[] {
  const hits = Array.from(text.matchAll(/\b([A-Z][a-z]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|PR|RI|SC|SD|TN|TX|UT|VA|VI|VT|WA|WI|WV))\b/g))
    .map(m => m[0]);
  return dedupe(hits).slice(0, 10);
}

function guessSize(text: string): CompanyProfile["sizeHint"] {
  if (/over\s*1000\s+employees|1,000\+/.test(text)) return "1000+";
  if (/\b(500-1000|501-1000)\b/.test(text)) return "501-1000";
  if (/\b(200-500|201-500)\b/.test(text)) return "201-500";
  if (/\b(50-200|51-200)\b/.test(text)) return "51-200";
  if (/\b(11-50)\b/.test(text)) return "11-50";
  if (/\b(1-10|small team|family-owned)\b/.test(text)) return "1-10";
  return undefined;
}

function ensureUrl(u: string): string {
  try { return new URL(u).toString(); } catch { return `https://${u.replace(/^https?:\/\//, "")}`; }
}

function hostPart(u: string): string {
  try { return new URL(ensureUrl(u)).hostname.replace(/^www\./, "").toLowerCase(); } catch { return u; }
}

function normalizePhone(s: string): string | undefined {
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = typeof x === "string" ? x.toLowerCase() : JSON.stringify(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function clamp01(x: number) { return Math.min(1, Math.max(0, x)); }

const STOP = new Set([
  "the","and","for","you","are","with","your","from","this","that","have","has","our","all","not","can","will","but",
  "about","more","was","she","his","her","they","them","who","what","when","where","why","how","which","their","it's",
  "www","com","https","home","shop","store","company","inc","llc","ltd","co","aka","into","over","under","within"
]);

const BG_STOP = new Set([
  "about us","contact us","learn more","read more","add cart","add to","to cart","free shipping","money back","return policy"
]);

// ---------------- Convenience: one-shot pipeline -----------------

export async function extractAndClassify(html: string, urlOrDomain: string, opts: { extract?: ExtractOptions; classify?: ClassifyOptions } = {}) {
  const profile = extractCompanyProfile(html, urlOrDomain, opts.extract);
  const classification = await classifyVertical(profile, opts.classify);
  return { profile, classification };
}
