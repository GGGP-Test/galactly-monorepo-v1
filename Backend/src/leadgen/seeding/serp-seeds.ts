// src/leadgen/seeding/serp-seeds.ts
/**
 * SERP-based lead seeding:
 *  - Builds vertical-aware queries
 *  - Calls Serper.dev or Google CSE (Programmable Search)
 *  - Normalizes & dedupes domains
 */
export type Vertical =
  | "ecommerce_food"
  | "meal_kits"
  | "cosmetics"
  | "supplements"
  | "beverages"
  | "pet"
  | "household"
  | "industrial_b2b"
  | "pharma_otc"
  | "apparel";

export interface SeedInput {
  vertical: Vertical;
  region?: "us" | "ca";
  packagingHints?: string[]; // e.g. ["corrugated", "stretch wrap", "poly mailer"]
  mustHave?: string[];       // words that must appear in snippet/url
  mustNot?: string[];        // words to exclude (e.g. "uline", "alibaba")
  maxResults?: number;       // total domains desired
  provider?: "serper" | "google_cse";
}

export interface SeedResult {
  domain: string;
  url: string;
  title?: string;
  snippet?: string;
  tags: string[];
  evidence: string[]; // why it surfaced (query, snippet hit)
}

export interface SearchClient {
  searchWeb(query: string, limit: number): Promise<Array<{ url: string; title?: string; snippet?: string }>>;
}

/** Build opinionated queries for a vertical */
export function buildQueries(input: SeedInput): string[] {
  const { vertical, region = "us", packagingHints = [] } = input;
  const base: Record<Vertical, string[]> = {
    ecommerce_food: [
      "site:*.com \"ship nationwide\" food subscription packaging",
      "DTC snacks packaging supplier needed",
    ],
    meal_kits: [
      "meal kit packaging cold chain boxes corrugated",
      "meal kit company insulation liner vendor",
    ],
    cosmetics: [
      "DTC cosmetics brand packaging boxes unboxing",
      "cosmetics fulfillment shipping boxes",
    ],
    supplements: [
      "supplement brand packaging bottles caps shrink sleeve",
      "nutraceutical DTC packaging supplier",
    ],
    beverages: [
      "beverage subscription packaging mailer can shipper",
      "craft soda ecommerce packaging",
    ],
    pet: [
      "pet food subscription packaging liner",
      "pet treats DTC packaging boxes",
    ],
    household: [
      "home goods DTC packaging fragile shipping",
      "glassware packaging supplier ecom",
    ],
    industrial_b2b: [
      "industrial supply shipping pallets stretch wrap buyers",
      "warehouse using stretch film vendor",
    ],
    pharma_otc: [
      "OTC brand blister packaging carton supplier",
      "pharmacy ecommerce cold pack mailer",
    ],
    apparel: [
      "apparel DTC poly mailer custom packaging",
      "streetwear brand unboxing mailer",
    ],
  };
  const hint = packagingHints.length ? (" " + packagingHints.join(" ")) : "";
  const geo = region === "us" ? " site:.us OR site:.com" : " site:.ca OR site:.com";
  return base[vertical].map(q => q + hint + geo);
}

/** Thin Serper.dev adapter (set SERPER_API_KEY) */
export class SerperClient implements SearchClient {
  constructor(private readonly key = process.env.SERPER_API_KEY) {}
  async searchWeb(query: string, limit = 20) {
    if (!this.key) throw new Error("SERPER_API_KEY missing");
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
    });
    const data = await r.json();
    const organic = data?.organic || [];
    return organic.map((o: any) => ({ url: o.link, title: o.title, snippet: o.snippet }));
  }
}

/** Thin Google CSE adapter (set GOOGLE_CSE_ID + GOOGLE_API_KEY) */
export class GoogleCSEClient implements SearchClient {
  constructor(private readonly cx = process.env.GOOGLE_CSE_ID, private readonly key = process.env.GOOGLE_API_KEY) {}
  async searchWeb(query: string, limit = 20) {
    if (!this.cx || !this.key) throw new Error("GOOGLE_CSE_ID/GOOGLE_API_KEY missing");
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", this.key);
    url.searchParams.set("cx", this.cx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(limit, 10)));
    const r = await fetch(url.toString());
    const data = await r.json();
    const items = data?.items || [];
    return items.map((i: any) => ({ url: i.link, title: i.title, snippet: i.snippet }));
  }
}

/** Normalize host → domain */
function toDomain(u: string): string {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch { return ""; }
}

/** Basic filters (you can extend with your PolicyEngine downstream) */
function isExcluded(u: string, mustNot: string[] = []) {
  const s = u.toLowerCase();
  if (/\b(alibaba|amazon|ebay|walmart|uline|westrock|packlane)\b/.test(s)) return true;
  return mustNot.some(x => s.includes(x.toLowerCase()));
}

export async function seedFromSERP(input: SeedInput, client?: SearchClient): Promise<SeedResult[]> {
  const {
    provider = process.env.SERPER_API_KEY ? "serper" : "google_cse",
    mustHave = [],
    mustNot = [],
    maxResults = 80,
    vertical,
    region,
    packagingHints,
  } = input;

  const search: SearchClient = client ?? (provider === "serper" ? new SerperClient() : new GoogleCSEClient());
  const queries = buildQueries({ vertical, region, packagingHints, mustHave, mustNot, maxResults, provider });
  const out: SeedResult[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const rows = await search.searchWeb(q, 20);
    for (const row of rows) {
      if (!row?.url) continue;
      if (isExcluded(row.url, mustNot)) continue;
      const d = toDomain(row.url);
      if (!d || seen.has(d)) continue;
      const passMustHave = mustHave.length === 0 || mustHave.some(m => (row.title || "").toLowerCase().includes(m.toLowerCase()) || (row.snippet || "").toLowerCase().includes(m.toLowerCase()));
      if (!passMustHave) continue;
      seen.add(d);
      out.push({
        domain: d,
        url: row.url,
        title: row.title,
        snippet: row.snippet,
        tags: [vertical, region || "us"],
        evidence: [q],
      });
      if (out.length >= maxResults) break;
    }
    if (out.length >= maxResults) break;
  }
  return out;
}
