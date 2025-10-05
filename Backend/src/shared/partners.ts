// src/shared/partners.ts
//
// Deterministic "partner graph" extractor for Artemis-B v1.
// Goal: spot evidence of partner/brand/client lists and relationship words
// (co-packer, distributor, 3PL, etc.) in raw website text and emit a compact,
// dependency-free signal that other modules can consume.
//
// No network, no I/O. Pure functions, CJS/ESM-safe exports.
//
// Exports:
//   - extractPartners(text: string): PartnerSignal
//   - summarizePartners(sig: PartnerSignal, max=6): string
//
// PartnerScore is 0..1 (monotonic with amount/strength of evidence).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PartnerKind = "brand" | "copacker" | "distributor" | "retailer" | "association" | "logistics";

export interface PartnerEdge {
  name: string;              // canonical partner/brand name
  kind: PartnerKind;         // best-effort relationship guess
  weight: number;            // 1..3 heuristic weight
  evidence: string;          // short token that triggered detection
}

export interface PartnerSignal {
  partners: PartnerEdge[];                     // distinct by name/kind
  partnerCounts: Record<PartnerKind, number>;  // count per kind
  partnerScore: number;                        // 0..1 overall confidence
  reasons: string[];                           // compact reasons (e.g., "copacker:2")
}

/* --------------------------------- utils ---------------------------------- */

const lc = (v: any) => String(v ?? "").toLowerCase();
const normWS = (s: string) => s.replace(/\s+/g, " ").trim();

function uniqBy<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// Very light brand tokenization for "Trusted by: Nike, Pepsi & Acme Inc."
function namesFromCsvish(line: string): string[] {
  const s = line
    .replace(/^[•\-–—\s]+/, "")                    // bullets
    .replace(/^(trusted by|our clients|clients|brands|customers|partners)\s*:\s*/i, "");
  // Split on commas / pipes / middots / ampersands
  const raw = s.split(/[,|•·;]| & | and /i).map(x => x.trim()).filter(Boolean);
  // Filter out too-short tokens and generic words
  const bad = new Set(["inc", "llc", "ltd", "co", "company", "group", "partners", "clients", "brands"]);
  const out: string[] = [];
  for (let token of raw) {
    // Collapse multiple words but keep case
    token = token.replace(/\s{2,}/g, " ").trim();
    if (token.length < 2) continue;
    const pieces = token.split(/\s+/);
    if (pieces.every(p => bad.has(lc(p)))) continue;
    // Heuristic: avoid lines that are obviously sentences
    if (token.split(" ").length <= 7) out.push(token);
  }
  return out;
}

/* ------------------------------ core rules -------------------------------- */

const KIND_PATTERNS: Array<{ kind: PartnerKind; re: RegExp; weight: number; evidence: string }> = [
  { kind: "copacker",     re: /\bco[-\s]?pack(ers?|ing)|contract pack(ers?|ing)|co[-\s]?man(ufactur(?:e|er|ing))\b/i, weight: 3, evidence: "copacker" },
  { kind: "distributor",  re: /\b(distributor|distribution|authorized reseller|dealer network)\b/i,                   weight: 2, evidence: "distributor" },
  { kind: "logistics",    re: /\b(3pl|third[-\s]?party logistics|fulfil?lment partner|logistics partner)\b/i,         weight: 2, evidence: "logistics" },
  { kind: "retailer",     re: /\b(stockists?|retail(?:ers| partners?)|where to buy|find us at)\b/i,                   weight: 2, evidence: "retailer" },
  { kind: "association",  re: /\b(member of|affiliations?|associations?|chamber of commerce|certified partner)\b/i,   weight: 1, evidence: "association" },
  { kind: "brand",        re: /\b(trusted by|our clients|clients|brands we work with|case studies|portfolio)\b/i,     weight: 1, evidence: "brands" },
];

// Extract partner-ish lines and brand lists.
export function extractPartners(text: string): PartnerSignal {
  const t = normWS(String(text || ""));
  if (!t) return { partners: [], partnerCounts: baseCounts(), partnerScore: 0, reasons: [] };

  // Split into light "lines" so we can scan context without expensive NLP
  const lines = t.split(/(?:\n|\r|\.)(?=\s*[A-Z]|\s*•|\s*-)/g).map(normWS).filter(Boolean);

  const edges: PartnerEdge[] = [];
  const counts = baseCounts();

  for (const line of lines) {
    // 1) Relationship keywords (co-packer, distributor, etc.)
    for (const rule of KIND_PATTERNS) {
      if (rule.re.test(line)) {
        // Try to harvest explicit names if present in same line
        const hintedNames = namesFromCsvish(line);
        if (hintedNames.length) {
          for (const name of hintedNames) {
            edges.push({ name, kind: rule.kind, weight: rule.weight, evidence: rule.evidence });
            counts[rule.kind] += 1;
          }
        } else {
          // No explicit brand list; record a generic edge to reflect evidence
          edges.push({ name: "(unspecified)", kind: rule.kind, weight: rule.weight, evidence: rule.evidence });
          counts[rule.kind] += 1;
        }
      }
    }

    // 2) Plain "Trusted by: X, Y, Z" without relationship words → brand edges
    if (/\b(trusted by|our clients|clients|brands|customers)\b.*[:\-]/i.test(line)) {
      const names = namesFromCsvish(line);
      for (const name of names) {
        edges.push({ name, kind: "brand", weight: 1, evidence: "brands" });
        counts.brand += 1;
      }
    }
  }

  // Dedup by name+kind; keep max weight
  const deduped = uniqBy(
    edges.sort((a, b) => b.weight - a.weight),
    (e) => `${lc(e.name)}|${e.kind}`
  );

  // Score: weighted sum with gentle saturation (0..1)
  const sum =
    3 * countKind(counts, "copacker") +
    2 * (countKind(counts, "distributor") + countKind(counts, "retailer") + countKind(counts, "logistics")) +
    1 * (countKind(counts, "association") + countKind(counts, "brand"));

  const partnerScore = saturate(sum, 0, 12); // 12+ treated as "maxed" signal

  // Reasons (compact)
  const reasons: string[] = [];
  for (const k of Object.keys(counts) as PartnerKind[]) {
    if (counts[k] > 0) reasons.push(`${k}:${counts[k]}`);
  }
  if (reasons.length > 6) reasons.length = 6;

  return { partners: deduped, partnerCounts: counts, partnerScore, reasons };
}

export function summarizePartners(sig: PartnerSignal, maxShown = 6): string {
  if (!sig?.partners?.length) return "no partner signals";
  const names = sig.partners
    .filter(p => p.name !== "(unspecified)")
    .map(p => p.name)
    .slice(0, maxShown);
  const list = names.join(", ") + (sig.partners.length > maxShown ? ", etc." : "");
  return `${Math.round(sig.partnerScore * 100)}% partner signal — ${list || "unspecified partners"}`;
}

/* ------------------------------ tiny helpers ------------------------------ */

function baseCounts(): Record<PartnerKind, number> {
  return { brand: 0, copacker: 0, distributor: 0, retailer: 0, association: 0, logistics: 0 };
}
function countKind(c: Record<PartnerKind, number>, k: PartnerKind): number { return Number(c[k] || 0); }
function saturate(sum: number, lo: number, hi: number): number {
  const clamped = Math.max(lo, Math.min(hi, sum));
  return (clamped - lo) / (hi - lo || 1);
}

export default { extractPartners, summarizePartners };