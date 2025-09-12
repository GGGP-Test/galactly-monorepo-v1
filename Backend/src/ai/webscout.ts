// backend/src/ai/webscout.ts
// Webscout primitives used by routes. Lean + synchronous defaults so build passes.

export type Persona = {
  productOrOffer: string;   // e.g., "Stretch film & pallet protection"
  solves: string;           // e.g., "Keeps pallets secure for storage/shipping"
  buyerTitles: string[];    // e.g., ["Warehouse Manager","Purchasing Manager","COO"]
};

export type Candidate = {
  host: string;
  title: string;
  temperature: "hot" | "warm";
  why: { label: string; kind: "meta" | "platform" | "signal" | "context"; score: number; detail?: string }[];
};

export type ScoutOptions = {
  supplierDomain: string;
  region?: "us" | "ca" | "US/CA" | string;
  radiusMi?: number;
  keywords?: string[];
};

// Human-readable persona/targets inference.
// Accepts both a simple domain string and an options object (to match existing route calls).
export async function inferPersonaAndTargets(
  input: string | ScoutOptions
): Promise<{ persona: Persona; inferredFrom: string[] }> {
  const opts: ScoutOptions = typeof input === "string" ? { supplierDomain: input } : input;

  // naive inference from supplier domain (replace with real AI later)
  const lower = opts.supplierDomain.toLowerCase();
  let productOrOffer = "Packaging";
  let solves = "Protects goods in transit";
  let buyerTitles = ["Procurement Manager", "Operations Manager"];

  if (lower.includes("stretch") || lower.includes("shrink")) {
    productOrOffer = "Stretch film & pallet protection";
    solves = "Keeps pallets secure for storage/shipping";
    buyerTitles = ["Warehouse Manager", "Purchasing Manager", "COO"];
  }

  return {
    persona: { productOrOffer, solves, buyerTitles },
    inferredFrom: [opts.supplierDomain],
  };
}

// Score and label candidates (warm/hot). Accept string OR object to match callers.
export async function scoreAndLabelCandidates(
  input: string | ScoutOptions
): Promise<{ candidates: Candidate[] }> {
  const opts: ScoutOptions = typeof input === "string" ? { supplierDomain: input } : input;

  // Placeholder: return empty set; routes handle empty safely.
  // (You can wire real-time web search here later.)
  return { candidates: [] };
}
