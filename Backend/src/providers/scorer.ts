/**
 * Path: Backend/src/providers/scorer.ts
 * Self-contained, zero-import scoring stub that always type-checks.
 * It turns raw web candidates into warm/hot leads with simple heuristics.
 */

export type ScoreLabel = "cold" | "warm" | "hot";

export type Candidate = {
  host: string;                // e.g., "blueboxretail.com"
  title?: string;              // e.g., "Purchasing Manager"
  tags?: string[];             // e.g., ["packaging","retail"]
  signals?: string[];          // free-form hints from upstream
  distanceMiles?: number;      // optional proximity
};

export type ScoredCandidate = Candidate & {
  score: number;               // 0..100
  label: ScoreLabel;
  reasons: string[];
};

export type ScoreOptions = {
  supplierDomain?: string;     // e.g., "peekpackaging.com"
  hotThreshold?: number;       // default 70
  warmThreshold?: number;      // default 40
};

const PKG_WORDS = [
  "packag", "box", "boxes", "carton", "label", "mailer",
  "poly", "pallet", "foam", "insert", "tape", "bag"
];

/** Tiny util: fuzzy contains */
function hasAny(hay: string, needles: string[]): boolean {
  const s = hay.toLowerCase();
  return needles.some(n => s.includes(n));
}

/** Score a single candidate deterministically. */
export function scoreOne(c: Candidate, opts: ScoreOptions = {}): ScoredCandidate {
  const reasons: string[] = [];
  const warmThreshold = opts.warmThreshold ?? 40;
  const hotThreshold  = opts.hotThreshold  ?? 70;

  let score = 0;

  // 1) Packaging intent via domain.
  if (hasAny(c.host, PKG_WORDS)) {
    score += 35;
    reasons.push("Domain indicates packaging intent");
  }

  // 2) Role/title hints.
  const role = (c.title ?? "").toLowerCase();
  if (/(procure|purchas|sourc|buyer|ops|operation|supply)/.test(role)) {
    score += 25;
    reasons.push("Relevant buyer/ops role");
  }

  // 3) Tags from upstream.
  const tags = (c.tags ?? []).map(t => t.toLowerCase());
  if (tags.some(t => hasAny(t, PKG_WORDS))) {
    score += 20;
    reasons.push("Packaging-related tag");
  }

  // 4) Free-form signals bump.
  const signals = (c.signals ?? []).join(" ").toLowerCase();
  if (signals.includes("rfq") || signals.includes("quote")) {
    score += 15;
    reasons.push("RFQ/quote signal");
  }

  // 5) Proximity bonus.
  if (typeof c.distanceMiles === "number") {
    if (c.distanceMiles <= 25) { score += 10; reasons.push("Local proximity"); }
    else if (c.distanceMiles <= 100) { score += 5; reasons.push("Regional proximity"); }
  }

  // 6) Supplier-domain affinity (weak, keeps it generic).
  if (opts.supplierDomain && hasAny(opts.supplierDomain, PKG_WORDS)) {
    score += 5;
    reasons.push("Supplier packaging affinity");
  }

  if (score > 100) score = 100;

  const label: ScoreLabel = score >= hotThreshold ? "hot"
                        : score >= warmThreshold ? "warm"
                        : "cold";

  return { ...c, score, label, reasons };
}

/** Batch scorer used by routes/pipeline. */
export async function scoreCandidates(
  candidates: Candidate[],
  opts: ScoreOptions = {}
): Promise<ScoredCandidate[]> {
  return candidates.map(c => scoreOne(c, opts));
}

/** Common aliases some codebases expect. */
export const scorer = scoreCandidates;

export default scoreCandidates;