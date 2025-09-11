export type PersonaTargets = {
  productOffer: string;
  solves: string;
  buyerTitles: string[];
  categories: string[];
};

export async function inferPersonaAndTargets(
  supplierDomain: string,
  regionHint?: string
): Promise<PersonaTargets> {
  // Super-light heuristic so builds pass; replace with real analyzer later.
  const host = supplierDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

  if (host.includes("stretch") || host.includes("shrink")) {
    return {
      productOffer: "Stretch film & pallet protection",
      solves: "Keeps pallets secure for storage and transit",
      buyerTitles: ["Warehouse Manager", "Purchasing Manager", "COO"],
      categories: ["Warehousing", "3PL", "Retail DC"],
    };
  }

  return {
    productOffer: "Custom packaging",
    solves: "Protects products and improves fulfillment",
    buyerTitles: ["Operations Manager", "Supply Chain Manager", "Procurement"],
    categories: ["E-commerce", "CPG", "Fulfillment"],
  };
}
