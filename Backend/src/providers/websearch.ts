/**
 * Path: Backend/src/providers/websearch.ts
 * Standalone, zero-dependency stub that always type-checks.
 * It synthesizes "web search" leads from heuristics, so the build is green
 * even without network access. Safe to keep until we wire a real crawler.
 */

export type Temp = "warm" | "hot";

export type WebSearchQuery = {
  supplierDomain: string;         // e.g., "peekpackaging.com"
  region?: "US/CA" | "US" | "CA"; // UI choices
  radiusMiles?: number;           // optional proximity hint
  limit?: number;                 // cap results
};

export type WebSearchResult = {
  host: string;                   // domain of the candidate buyer
  title: string;                  // role or page label
  platform: "web" | "news";
  temp: Temp;                     // warm | hot
  why: string;                    // human-readable reason
  created: string;                // ISO timestamp
};

/** Small built-in corpus so we always return something. */
const CORPUS: Array<{ host: string; region: "US" | "CA"; roles: string[]; tags: string[] }> = [
  { host: "blueboxretail.com", region: "US", roles: ["Purchasing Manager"], tags: ["retail","packaging","boxes"] },
  { host: "acmefoods.com",     region: "US", roles: ["Procurement Lead"],   tags: ["food","packaging","labels"] },
  { host: "nwpallets.ca",      region: "CA", roles: ["Buyer"],              tags: ["pallets","packaging"] },
  { host: "logiship.com",      region: "US", roles: ["Head of Ops"],        tags: ["logistics","packaging","foam"] },
  { host: "freshgrocer.com",   region: "US", roles: ["Sourcing Manager"],   tags: ["grocery","packaging","bags"] },
  { host: "peakoutdoors.ca",   region: "CA", roles: ["Purchasing Manager"], tags: ["outdoors","packaging","mailers"] },
];

/** Simple scorer → classifies warm/hot using supplier & tag affinity. */
function classify(domain: string, tags: string[], radius?: number): { temp: Temp; why: string } {
  const pkg = /packag|box|label|mailer|carton|poly|pallet/i.test(domain);
  let score = 0;
  if (pkg) score += 2;
  if (tags.includes("packaging")) score += 2;
  if ((radius ?? 0) <= 50) score += 1;
  const temp: Temp = score >= 4 ? "hot" : "warm";
  const why =
    temp === "hot"
      ? "High packaging intent + proximity."
      : "Likely packaging buyer (industry/role).";
  return { temp, why };
}

/**
 * Primary exported function.
 * Returns deterministic “web” results so the rest of the pipeline can run.
 */
export async function websearch(q: WebSearchQuery): Promise<WebSearchResult[]> {
  const region = q.region ?? "US/CA";
  const radius = q.radiusMiles ?? 50;
  const now = new Date().toISOString();

  const pool = CORPUS.filter(s => (region === "US/CA" ? true : s.region === region));
  const results = pool.map(s => {
    const { temp, why } = classify(q.supplierDomain, s.tags, radius);
    return {
      host: s.host,
      title: s.roles[0] ?? "Buyer",
      platform: "web" as const,
      temp,
      why,
      created: now,
    };
  });

  const limit = q.limit && q.limit > 0 ? q.limit : undefined;
  return limit ? results.slice(0, limit) : results;
}

/** Common alias names some routes might use; all point to `websearch`. */
export const searchWeb = websearch;
export const searchBuyersOnWeb = websearch;
export default websearch;