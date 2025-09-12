/* backend/src/ai/webscout.ts */

// Minimal types; extend as needed.
export type PersonaGuess = {
  productOffer: string;          // e.g., "Stretch film & pallet protection"
  solves: string;                // e.g., "Keeps pallets secure for storage & transit"
  buyerTitles: string[];         // e.g., ["Warehouse Manager", "Purchasing Manager", "COO"]
  regionsSeededFrom?: string;    // where we start the geo search (city/state)
};

export type TargetsGuess = {
  industries: string[];          // e.g., ["3PL", "Retail DCs", "E-commerce Fulfillment"]
  intentSignals: string[];       // human-readable signals we found
};

// Export the symbol your route is importing.
export async function inferPersonaAndTargets(
  supplierDomain: string,
  opts?: { region?: string; radiusMi?: number }
): Promise<{ persona: PersonaGuess; targets: TargetsGuess }> {
  // NOTE: keep this lightweight in v0; you can wire real scorers/fetchers next.
  const domain = supplierDomain?.toLowerCase() ?? '';

  const persona: PersonaGuess = {
    productOffer: 'Stretch film & pallet protection',
    solves: 'Keeps pallets secure for storage & transit',
    buyerTitles: ['Warehouse Manager', 'Purchasing Manager', 'COO'],
    regionsSeededFrom: opts?.region || 'US/CA',
  };

  // Very simple domain-based hints (replace with real detectors later)
  const targets: TargetsGuess = {
    industries: domain.includes('shrink') || domain.includes('stretch')
      ? ['3PL', 'Retail Distribution Centers', 'Manufacturing (light assembly)']
      : ['General Warehousing', 'E-commerce Fulfillment', 'CPG'],
    intentSignals: [
      'Catalog + shipping + returns detected',
      'Recent product/category updates (last 30–90 days)',
    ],
  };

  return { persona, targets };
}
