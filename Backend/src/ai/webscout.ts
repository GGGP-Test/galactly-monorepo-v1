// ----- shared types -----
export type Persona = {
  productOffer: string;
  solves: string;
  buyerTitles: string[];
};

export type Targets = {
  // keep simple; expand later as needed
  regions: string[];
  keywords: string[];
};

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

// ----- persona/targets -----
export async function inferPersonaAndTargets(domain: string): Promise<{
  persona: Persona;
  targets: Targets;
  inferredFrom: string[];
}> {
  // lightweight defaults; UI is human-editable
  return {
    persona: {
      productOffer: "Stretch film & pallet protection",
      solves: "Keeps pallets secure for storage & transit",
      buyerTitles: ["Warehouse Manager", "Purchasing Manager", "COO"]
    },
    targets: {
      regions: ["US", "CA"],
      keywords: ["pallet wrap", "stretch film", "packaging supplies"]
    },
    inferredFrom: [domain]
  };
}

// ----- candidates -----
export type ScoreOpts = { region?: string; radiusMi?: number };

// overloads to match both calling styles seen in routes
export async function scoreAndLabelCandidates(
  domain: string,
  opts?: ScoreOpts
): Promise<Candidate[]>;
export async function scoreAndLabelCandidates(input: {
  supplierDomain: string;
  region?: string;
  radiusMi?: number;
}): Promise<Candidate[]>;
export async function scoreAndLabelCandidates(
  a: string | { supplierDomain: string; region?: string; radiusMi?: number },
  b?: ScoreOpts
): Promise<Candidate[]> {
  const supplierDomain = typeof a === "string" ? a : a.supplierDomain;
  const _opts = (typeof a === "string" ? b : { region: a.region, radiusMi: a.radiusMi }) ?? {};

  // minimal stub for now — real WebScout will fill this in
  void supplierDomain;
  void _opts;

  return [];
}
