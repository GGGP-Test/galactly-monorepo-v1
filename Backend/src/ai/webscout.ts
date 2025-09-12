export type WhyChip = {
  label: string;
  kind: "domain" | "platform" | "intent" | "context";
  score: number; // 0..1
  detail?: string;
};

export type Candidate = {
  cat: "product";
  platform: "unknown" | "shopify" | "bigcommerce" | "custom";
  host: string;
  title: string;
  keywords?: string;
  temperature: "hot" | "warm";
  why: WhyChip[];
};

export async function inferPersonaAndTargets(domain: string): Promise<{
  productOffer: string;
  solves: string;
  buyerTitles: string[];
}> {
  // Lightweight default; the UI is human-editable anyway.
  return {
    productOffer: "Stretch film & pallet protection",
    solves: "Keeps pallets secure for storage & transit",
    buyerTitles: ["Warehouse Manager", "Purchasing Manager", "COO"],
  };
}

export async function scoreAndLabelCandidates(
  supplierDomain: string,
  opts: { region?: string; radiusMi?: number }
): Promise<Candidate[]> {
  // Minimal stub: return an empty array (so the API works and UI loads).
  // Your real WebScout logic can fill this with scored candidates.
  void supplierDomain;
  void opts;
  return [];
}
