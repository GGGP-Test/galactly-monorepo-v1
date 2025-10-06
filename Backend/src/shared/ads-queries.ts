// src/shared/ads-queries.ts
// Build platform/search queries from Artemis prefs/tags (pure, no deps).

export type QueryInput = {
  city?: string;
  categoriesAllow?: string[]; // from EffectivePrefs
};

const BASE_SYNONYMS: Record<string, string[]> = {
  film: ["shrink film", "stretch film", "poly film", "packaging film"],
  labels: ["product labels", "sticker labels", "label printing"],
  boxes: ["corrugated boxes", "shipping boxes", "cartons"],
  pouches: ["stand up pouch", "mylar bags", "flexible pouch"],
  bottle: ["bottle labels", "bottle packaging", "beverage packaging"],
  cosmetics: ["cosmetics packaging", "beauty packaging"],
  food: ["food packaging", "fsma packaging", "haccp packaging"],
  beverage: ["beverage packaging", "shrink sleeve", "six pack ring"],
  pharma: ["pharmaceutical packaging", "cGMP packaging", "tamper evident"],
  cannabis: ["cannabis packaging", "child resistant packaging"],
  logistics: ["void fill", "protective packaging", "mailers"],
  industrial: ["pallet wrap", "palletizing", "strapping"],
};

function uniq(a: string[]) { return Array.from(new Set(a.map(s => s.trim().toLowerCase()))).filter(Boolean); }

function expandTerms(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    out.push(t);
    const syn = BASE_SYNONYMS[t] || BASE_SYNONYMS[t.replace(/\s+/g, "")] || [];
    out.push(...syn);
  }
  return uniq(out);
}

/** Build ~10–40 crisp search phrases for ATC-like UIs. */
export function buildAdSearchQueries(input: QueryInput): string[] {
  const tags = uniq(input.categoriesAllow || []);
  const base = expandTerms(tags);
  const out: string[] = [];

  // 1) raw terms
  out.push(...base);

  // 2) packaging-intent variants
  for (const t of base) {
    out.push(`${t} packaging`);
    out.push(`${t} supplier`);
    out.push(`${t} manufacturer`);
    out.push(`${t} wholesale`);
  }

  // 3) geo variants (optional)
  const city = (input.city || "").trim();
  if (city) {
    for (const t of base.slice(0, 12)) {
      out.push(`${t} ${city}`);
      out.push(`${t} near ${city}`);
    }
  }

  // cap & de-dup
  return uniq(out).slice(0, 40);
}

export default { buildAdSearchQueries };