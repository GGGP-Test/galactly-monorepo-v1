// src/ai/providers/search-providers.ts

/**
 * Search provider abstraction.
 * - FREE: Generates high-signal packaging queries for manual/queued execution.
 * - PRO: Executes queries against paid APIs (Brave, Bing, Google CSE) when keys exist.
 *
 * Consumers get normalized SearchResult objects and can feed domains to the pipeline.
 */

export type SearchMode = "FREE" | "PRO";

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  score?: number; // provider-specific confidence
  source?: "brave" | "bing" | "google_cse";
}

export interface SearchProvider {
  id: string;
  mode: SearchMode;
  /**
   * Free providers may return ONLY queries (urlsAsQueries=true) which you can
   * dispatch through your own fetcher or queue. PRO providers return full results.
   */
  searchPackagingLeads(
    region: "us" | "ca",
    categories: string[],
    opts?: { limit?: number; urlsAsQueries?: boolean }
  ): Promise<SearchResult[]>;
}

export function getSearchProvider(): SearchProvider {
  if (process.env.BRAVE_API_KEY) return new BraveSearchProvider();
  if (process.env.BING_ENDPOINT && process.env.BING_KEY) return new BingSearchProvider();
  if (process.env.GOOGLE_CSE_ID && process.env.GOOGLE_CSE_KEY) return new GoogleCSEProvider();
  return new FreeQueryProvider();
}

// ---------------------- FREE query generator (no external calls) ------------

class FreeQueryProvider implements SearchProvider {
  id = "free-query";
  mode: SearchMode = "FREE";

  async searchPackagingLeads(
    region: "us" | "ca",
    categories: string[],
    opts?: { limit?: number; urlsAsQueries?: boolean }
  ): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 30;
    const queries = buildPackagingQueries(region, categories).slice(0, limit);

    if (opts?.urlsAsQueries) {
      // Return query URLs that can be opened manually or by your headless fetcher.
      return queries.map(q => ({
        title: q.label,
        url: q.url,
        snippet: q.query,
        score: 0.1,
        source: undefined,
      }));
    }

    // In FREE mode without external APIs, we return "pseudo results" to be consumed
    // by a later job that actually visits each SERP link and extracts domains.
    return queries.map(q => ({
      title: q.label,
      url: q.query, // the raw query string
      snippet: "SERP query (free mode) – supply a PRO search provider to resolve.",
      score: 0.1,
    }));
  }
}

function buildPackagingQueries(region: "us" | "ca", categories: string[]) {
  const geo = region === "us" ? "United States" : "Canada";
  const catTerms = categories.length ? categories : ["stretch wrap", "corrugated boxes", "poly mailers", "packaging tape"];
  const footprints = [
    `"Request a quote"`,
    `"bulk pricing"`,
    `"minimum order"`,
    `"same day shipping"`,
    `"order now"`,
    `"distributor" OR "wholesaler"`,
  ];
  const siteFilters = [
    // Buyers (ecommerce/brands likely needing packaging):
    `site:shopify.com OR site:myshopify.com`,
    `site:bigcommerce.com`,
    `site:woocommerce.com`,
    // Suppliers (to match with your users):
    `site:.store OR site:.shop OR site:.supply`,
  ];

  const label = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, 120);
  const toURL = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  const out: { label: string; query: string; url: string }[] = [];
  for (const cat of catTerms) {
    for (const fp of footprints) {
      out.push({
        label: `Buyers likely: ${cat} · ${fp} · ${geo}`,
        query: `${cat} ${fp} "${geo}"`,
        url: toURL(`${cat} ${fp} "${geo}"`),
      });
    }
    for (const filter of siteFilters) {
      out.push({
        label: `Footprint: ${cat} · ${geo} · ${filter}`,
        query: `${cat} ${filter} "${geo}"`,
        url: toURL(`${cat} ${filter} "${geo}"`),
      });
    }
    // B2B directories (lead discovery, not scraping; visit pages and then the company site)
    out.push({
      label: `Directory: ${cat} suppliers ${geo}`,
      query: `${cat} suppliers directory "${geo}"`,
      url: toURL(`${cat} suppliers directory "${geo}"`),
    });
  }
  return dedupeQueries(out);
}

function dedupeQueries(list: { label: string; query: string; url: string }[]) {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.query.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------- PRO Providers (require API keys) --------------------

class BraveSearchProvider implements SearchProvider {
  id = "brave";
  mode: SearchMode = "PRO";
  async searchPackagingLeads(
    region: "us" | "ca",
    categories: string[],
    opts?: { limit?: number }
  ): Promise<SearchResult[]> {
    const queries = buildPackagingQueries(region, categories);
    const limit = opts?.limit ?? 50;
    const results: SearchResult[] = [];
    for (const q of queries.slice(0, Math.min(limit, 20))) {
      const page = await braveSearch(q.query, 10);
      results.push(...page);
    }
    return normalizeResults(results, "brave");
  }
}

class BingSearchProvider implements SearchProvider {
  id = "bing";
  mode: SearchMode = "PRO";
  async searchPackagingLeads(region: "us" | "ca", categories: string[], opts?: { limit?: number }): Promise<SearchResult[]> {
    const queries = buildPackagingQueries(region, categories);
    const limit = opts?.limit ?? 50;
    const results: SearchResult[] = [];
    for (const q of queries.slice(0, Math.min(limit, 20))) {
      const page = await bingSearch(q.query, 10);
      results.push(...page);
    }
    return normalizeResults(results, "bing");
  }
}

class GoogleCSEProvider implements SearchProvider {
  id = "google_cse";
  mode: SearchMode = "PRO";
  async searchPackagingLeads(region: "us" | "ca", categories: string[], opts?: { limit?: number }): Promise<SearchResult[]> {
    const queries = buildPackagingQueries(region, categories);
    const limit = opts?.limit ?? 50;
    const results: SearchResult[] = [];
    for (const q of queries.slice(0, Math.min(limit, 20))) {
      const page = await googleCSE(q.query, 10);
      results.push(...page);
    }
    return normalizeResults(results, "google_cse");
  }
}

// ---------------------- Provider HTTP helpers -------------------------------

async function braveSearch(q: string, count = 10): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`, {
    headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY! },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const items = (json?.web?.results || []) as any[];
  return items.map((i) => ({ title: i.title, url: i.url, snippet: i.snippet, score: i.metric }));
}

async function bingSearch(q: string, count = 10): Promise<SearchResult[]> {
  const endpoint = process.env.BING_ENDPOINT!;
  const key = process.env.BING_KEY!;
  const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}&count=${count}`, {
    headers: { "Ocp-Apim-Subscription-Key": key },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const items = (json?.webPages?.value || []) as any[];
  return items.map((i) => ({ title: i.name, url: i.url, snippet: i.snippet, score: i.rank }));
}

async function googleCSE(q: string, num = 10): Promise<SearchResult[]> {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx = process.env.GOOGLE_CSE_ID!;
  const res = await fetch(
    `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&num=${num}`
  );
  if (!res.ok) return [];
  const json = await res.json();
  const items = (json?.items || []) as any[];
  return items.map((i) => ({ title: i.title, url: i.link, snippet: i.snippet }));
}

// ---------------------- Normalization ---------------------------------------

function normalizeResults(list: SearchResult[], source: SearchResult["source"]) {
  const deduped: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const url = normalizeUrl(r.url);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...r, url, source });
  }
  return deduped;
}
function normalizeUrl(u: string) {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch { return u; }
}
