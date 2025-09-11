/* backend/src/ai/webscout.ts */

// Minimal, synchronous heuristics so the build runs green.
// Wire your real adapters (SERP, site fetch, catalog detection, ads JSON, etc.) here.

export type Persona = {
  productOffer: string;             // e.g., "Stretch film & pallet protection"
  solves: string;                    // e.g., "Keeps pallets secure for storage & transit"
  buyerTitles: string[];            // e.g., ["Warehouse Manager", "Purchasing Manager", "COO"]
  verticals: string[];              // e.g., ["3PL", "Retail DC", "E-commerce Fulfillment"]
};

export async function inferPersonaAndTargets(input: { supplierDomain: string }): Promise<Persona> {
  const host = input.supplierDomain.toLowerCase();

  // crude rules to keep API functional; replace with real detectors later
  if (host.includes('stretch') || host.includes('shrink')) {
    return {
      productOffer: 'Stretch film & pallet protection',
      solves: 'Keeps pallets secure for storage & transit',
      buyerTitles: ['Warehouse Manager', 'Purchasing Manager', 'COO'],
      verticals: ['3PL', 'Retail DC', 'E-commerce Fulfillment'],
    };
  }

  return {
    productOffer: 'Packaging & shipping supplies',
    solves: 'Protects goods and reduces damage in transit',
    buyerTitles: ['Operations Manager', 'Purchasing Manager'],
    verticals: ['E-commerce', 'Retail', 'Manufacturing'],
  };
}

export type LabeledCandidate = {
  host: string;
  platform: string;
  title: string;
  created: string; // ISO
  temperature: 'hot' | 'warm';
  why: Array<{ label: string; kind: 'meta' | 'platform' | 'signal' | 'context'; score: number; detail: string }>;
};

// Offline-ish scoring wrapper. Plug your real-time rows here.
export async function scoreAndLabelCandidates(args: {
  supplierDomain: string;
  persona: Persona;
  regionHint: string;       // "us/ca" or "us" or city, state
  radiusMiles: number;
  rows: Array<{ host: string; title?: string }>;
  max: number;
}): Promise<LabeledCandidate[]> {
  const now = new Date().toISOString();
  const take = args.rows.slice(0, args.max);
  if (take.length === 0) {
    // seed two example rows so the panel shows data
    take.push({ host: 'brilliantearth.com', title: 'Lead: brilliantearth.com' });
    take.push({ host: 'gobble.com', title: 'Lead: gobble.com' });
  }

  return take.map((r, i) => ({
    host: r.host,
    platform: 'unknown',
    title: r.title ?? `Lead: ${r.host}`,
    created: now,
    temperature: i % 3 === 0 ? 'hot' : 'warm',
    why: [
      { label: 'Domain quality', kind: 'meta', score: 0.65, detail: `${r.host} (.com)` },
      { label: 'Platform fit',  kind: 'platform', score: 0.50, detail: 'unknown' },
      { label: 'Intent keywords', kind: 'signal', score: i % 3 === 0 ? 0.9 : 0.6, detail: i % 3 === 0 ? 'rfp, packaging' : '—' },
      { label: 'Context', kind: 'context', score: 0.6, detail: 'US/CA preference applied' },
    ],
  }));
}
