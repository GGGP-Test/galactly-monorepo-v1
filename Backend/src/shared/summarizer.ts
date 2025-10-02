// src/shared/summarizer.ts
//
// Evolved one-liner builder
// - Smarter enumeration: lists 1–3 exactly; 4–5 fully; 6–7 => “plus N more”;
//   8+ => “and more” (or compressed counts for sectors).
// - Chooses natural “and” with Oxford comma.
// - Normalizes + dedupes tokens, drops generic fluff (“custom”, “solutions”, …).
// - Adapts if the sentence gets too long (> maxLen or > maxWords).
// - Flexible style via options.
//
// This module is standalone. No external deps.

export type Role = "packaging_supplier" | "packaging_buyer" | "neither";

export interface BuildOptions {
  /** overall verbosity hint */
  style?: "concise" | "normal" | "rich";
  /** hard ceiling before we auto-compress (characters, incl. spaces) */
  maxLen?: number;
  /** hard ceiling on word count before auto-compress */
  maxWords?: number;
  /** noun after sectors; defaults to "brands" */
  audienceNoun?: string;
}

/* -------------------------------------------------------------------------- */
/* Basic normalizers                                                          */
/* -------------------------------------------------------------------------- */

const STOP_PRODUCT = new Set([
  "packaging",
  "package",
  "packages",
  "solutions",
  "solution",
  "custom",
  "customized",
  "quality",
  "premium",
  "innovative",
  "innovation",
  "supplies",
  "supply",
  "products",
  "product",
]);

const CANON_PLURALS: Record<string, string> = {
  // light canonicalization so “box/boxes” render consistently
  box: "boxes",
  carton: "cartons",
  label: "labels",
  bottle: "bottles",
  jar: "jars",
  pallet: "pallets",
  mailer: "mailers",
  pouch: "pouches",
  tray: "trays",
  closure: "closures",
  cap: "caps",
  clamshell: "clamshells",
};

function toPluralish(s: string): string {
  const w = s.toLowerCase();
  if (CANON_PLURALS[w]) return CANON_PLURALS[w];
  // very light plural heuristic; avoid mangling “film”, “tape”, etc.
  if (/(s|x|z|ch|sh)$/.test(w)) return w; // already plural-ish
  if (w.endsWith("y") && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w; // leave as-is; we don’t want to overreach
}

function tidyToken(raw: string): string {
  return raw
    .replace(/&/g, " & ")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqKeepOrder(a: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of a) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** normalize product tokens: tidy, de-fluff, pluralize canonically, dedupe */
function normalizeProducts(tokens: string[]): string[] {
  const clean = tokens
    .map(tidyToken)
    .map(t => t.replace(/\b(custom|bespoke|premium|quality)\b/gi, "").trim())
    .map(t => t.replace(/\b(packaging|package|solutions?)\b/gi, "").trim())
    .map(t => t.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(toPluralish)
    .filter(t => !STOP_PRODUCT.has(t));
  return uniqKeepOrder(clean);
}

/** hide noisy sector labels and tidy */
function normalizeSectors(sectors: string[]): string[] {
  const noisy = new Set(["general", "home", "all", "other", "misc", "others"]);
  const cleaned = sectors
    .map(tidyToken)
    .filter(s => s && !noisy.has(s));
  return uniqKeepOrder(cleaned);
}

function titleSafeHost(host: string): string {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function verbForRole(role: Role): string {
  switch (role) {
    case "packaging_supplier": return "supplies packaging";
    case "packaging_buyer":    return "buys packaging";
    default:                   return "does business";
  }
}

/* -------------------------------------------------------------------------- */
/* Human lists                                                                */
/* -------------------------------------------------------------------------- */

/** Oxford-comma join with “and” for the last element. */
function joinOxford(items: string[]): string {
  const n = items.length;
  if (n === 0) return "";
  if (n === 1) return items[0];
  if (n === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, n - 1).join(", ")} and ${items[n - 1]}`;
}

/**
 * Smarter human list:
 * - 1–3: joinOxford
 * - 4–5 (style !== "concise"): list all (reads fine)
 * - 6–7: show first 4 then "plus N more"
 * - 8+: show first 3 then "and more"
 */
function listAdaptive(items: string[], style: "concise" | "normal" | "rich"): {
  text: string; used: string[]; truncated: boolean;
} {
  const n = items.length;
  if (n === 0) return { text: "", used: [], truncated: false };
  if (n <= 3) return { text: joinOxford(items), used: items, truncated: false };
  if (n <= 5 && style !== "concise") {
    return { text: joinOxford(items), used: items, truncated: false };
  }
  if (n <= 7) {
    const head = items.slice(0, 4);
    const more = n - head.length;
    return { text: `${joinOxford(head)} plus ${more} more`, used: head, truncated: true };
  }
  // 8+
  const head = items.slice(0, 3);
  return { text: `${joinOxford(head)} and more`, used: head, truncated: true };
}

/* -------------------------------------------------------------------------- */
/* Length guard                                                               */
/* -------------------------------------------------------------------------- */

function wordCount(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

/* -------------------------------------------------------------------------- */
/* Public builder                                                             */
/* -------------------------------------------------------------------------- */

export function buildOneLiner(
  rawHost: string,
  role: Role,
  productTokens: string[] = [],
  sectorTokens: string[] = [],
  opts: BuildOptions = {}
): string {
  const style = opts.style ?? "normal";
  const maxLen = Math.max(80, opts.maxLen ?? 160);
  const maxWords = Math.max(12, opts.maxWords ?? 26);
  const noun = (opts.audienceNoun || "brands").trim();

  const host = titleSafeHost(rawHost);
  const verb = verbForRole(role);

  const products = normalizeProducts(productTokens);
  const sectors = normalizeSectors(sectorTokens);

  // First pass (rich-ish but bounded)
  const p = listAdaptive(products, style);
  let sectorText = "";
  if (sectors.length > 0) {
    if (sectors.length <= 3) {
      sectorText = ` for ${joinOxford(sectors)} ${noun}`;
    } else if (sectors.length <= 6) {
      const head = sectors.slice(0, 3);
      sectorText = ` for ${sectors.length} industries including ${joinOxford(head)}`;
    } else {
      const head = sectors.slice(0, 3);
      sectorText = ` across ${sectors.length}+ industries (e.g., ${joinOxford(head)})`;
    }
  }

  let line = `${host} ${verb}`;
  if (p.text) line += ` — ${p.text}`;
  line += sectorText || ".";
  if (!line.endsWith(".")) line += ".";

  // If too long, compress gracefully (don’t lose clarity)
  if (line.length > maxLen || wordCount(line) > maxWords) {
    // Compress products first
    let p2 = p;
    if (!p.truncated) {
      // force truncation form
      if (products.length > 3) {
        const head = products.slice(0, 3);
        p2 = { text: `${joinOxford(head)} and more`, used: head, truncated: true };
      }
    } else {
      // already truncated; shorten further if still long
      const head = products.slice(0, 2);
      p2 = { text: `${joinOxford(head)}+`, used: head, truncated: true };
    }

    // Compress sectors next
    let sector2 = sectorText;
    if (sectors.length > 0) {
      if (sectors.length <= 3) {
        sector2 = ` for ${joinOxford(sectors)} ${noun}`;
      } else {
        const head = sectors.slice(0, 2);
        sector2 = ` across ${sectors.length}+ industries (incl. ${joinOxford(head)})`;
      }
    }

    let compact = `${host} ${verb}`;
    if (p2.text) compact += ` — ${p2.text}`;
    compact += sector2 || ".";
    if (!compact.endsWith(".")) compact += ".";
    line = compact;
  }

  // Final ultra-compact guard (very rare)
  if (line.length > maxLen + 20) {
    const p3 = products.slice(0, 2);
    const s3 = sectors.slice(0, 2);
    let ultra = `${host} ${verb}`;
    if (p3.length) ultra += ` — ${joinOxford(p3)}${products.length > p3.length ? "+" : ""}`;
    if (s3.length) {
      ultra += ` for ${joinOxford(s3)}${sectors.length > s3.length ? "…" : ""} ${noun}`;
    }
    if (!ultra.endsWith(".")) ultra += ".";
    line = ultra;
  }

  return line;
}

/* -------------------------------------------------------------------------- */
/* Exports for reuse                                                          */
/* -------------------------------------------------------------------------- */

export const OneLiner = {
  buildOneLiner,
  normalizeProducts,
  normalizeSectors,
  titleSafeHost,
  verbForRole,
  joinOxford,
  listAdaptive,
};