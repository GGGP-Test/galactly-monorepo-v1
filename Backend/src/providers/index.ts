/**
 * Single-file provider orchestrator used by the Free Panel "Find buyers" action.
 * Self-contained to avoid cross-file breakage while we stabilize the rest.
 * Path: Backend/src/providers/index.ts
 */

export type Temp = "warm" | "hot";

export type Candidate = {
  id: string;             // stable key for UI tables
  host: string;           // domain
  platform: "seed" | "web" | "news";
  title: string;          // e.g. "Purchasing Manager"
  created: string;        // ISO timestamp
  temp: Temp;             // warm | hot
  why: string;            // human-readable reason
};

export type FindBuyersInput = {
  supplierDomain: string;       // e.g. "peekpackaging.com"
  region?: "US/CA" | "US" | "CA";
  radiusMiles?: number;         // UI passes something like 50
};

export type FindBuyersResult = {
  created: number;
  hot: number;
  warm: number;
  candidates: Candidate[];
};

/** Minimal seed list so the panel shows results even without web search. */
const SEEDS: Array<{
  host: string;
  region: "US" | "CA";
  roles: string[];
  tags: string[]; // simple intent tags
}> = [
  { host: "blueboxretail.com", region: "US", roles: ["Purchasing Manager"], tags: ["retail","packaging","boxes"] },
  { host: "acmefoods.com",     region: "US", roles: ["Procurement Lead"],   tags: ["food","packaging","labels"] },
  { host: "nwpallets.ca",      region: "CA", roles: ["Buyer"],              tags: ["pallets","packaging"] },
  { host: "logiship.com",      region: "US", roles: ["Head of Ops"],        tags: ["logistics","packaging","foam"] },
  { host: "freshgrocer.com",   region: "US", roles: ["Sourcing Manager"],   tags: ["grocery","packaging","bags"] },
  { host: "peakoutdoors.ca",   region: "CA", roles: ["Purchasing Manager"], tags: ["outdoors","packaging","mailers"] },
  { host: "peekpackaging.com", region: "US", roles: ["Buyer"],              tags: ["packaging"] },
  { host: "shipright.us",      region: "US", roles: ["Operations"],         tags: ["shipping","packaging"] },
  { host: "northgrove.ca",     region: "CA", roles: ["Procurement"],        tags: ["cpgn","packaging"] },
  { host: "warehouseworks.us", region: "US", roles: ["Purchasing"],         tags: ["3pl","packaging"] },
];

/** Very simple hot/warm classifier. Tune later. */
function classify(supplierDomain: string, seedTags: string[], radiusMiles?: number): { temp: Temp; why: string } {
  const supplierIsPackaging =
    /packag|box|mail(er)?|label|carton|poly|pallet/i.test(supplierDomain);

  let score = 0;
  if (supplierIsPackaging) score += 2;
  if (seedTags.includes("packaging")) score += 2;
  if ((radiusMiles ?? 0) <= 50) score += 1; // closer → hotter (coarse)
  // Add a tiny bias if domains share tokens
  const supplierToken = supplierDomain.split(".")[0];
  if (seedTags.some(t => supplierToken.includes(t))) score += 1;

  const temp: Temp = score >= 4 ? "hot" : "warm";
  const why =
    temp === "hot"
      ? "Strong packaging intent + close radius."
      : "Likely packaging buyer based on industry/role.";
  return { temp, why };
}

/** Public API used by the route handler. */
export async function findBuyers(input: FindBuyersInput): Promise<FindBuyersResult> {
  const region = input.region ?? "US/CA";
  const radiusMiles = input.radiusMiles ?? 50;

  console.log("[providers] findBuyers called", {
    supplierDomain: input.supplierDomain,
    region,
    radiusMiles,
  });

  // Region filter
  const pool = SEEDS.filter(s =>
    region === "US/CA" ? true : s.region === region
  );

  const now = new Date().toISOString();

  const candidates: Candidate[] = pool.map((s, idx) => {
    const { temp, why } = classify(input.supplierDomain, s.tags, radiusMiles);
    return {
      id: `${s.host}#${idx}`,
      host: s.host,
      platform: "seed",
      title: s.roles[0] ?? "Buyer",
      created: now,
      temp,
      why,
    };
  });

  const hot = candidates.filter(c => c.temp === "hot").length;
  const warm = candidates.length - hot;

  const result: FindBuyersResult = {
    created: candidates.length,
    hot,
    warm,
    candidates,
  };

  console.log("[providers] findBuyers result", {
    created: result.created,
    hot: result.hot,
    warm: result.warm,
  });

  return result;
}

/** Optional: tiny health util some routes might import. Safe no-op. */
export function providersHealth(): "ok" { return "ok"; }