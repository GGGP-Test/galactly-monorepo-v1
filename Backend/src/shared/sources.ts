// src/shared/sources.ts
//
// Web-first buyer discovery (Artemis B v1 — expanded).
// - Families/verticals for primary + secondary packaging buyers (cross-size).
// - Size is a HINT only; verticals can be small/mid/large simultaneously.
// - Optional overlays: sectors[] and products[] to bias queries.
// - Google Places Text Search (+limited Details) → OSM fallback.
// - Filters non-actionable hosts (google, yelp, fb/ig, job boards, directories).
// - Hard dedupe by host; caps lookups to keep quotas safe.
//
// Notes
// • This is deterministic and keyless-safe (OSM path). If PLACES_API_KEY
//   is present we prefer Places for higher precision sites.
// • We purposely search for BUYERS (co-packers, 3PLs, warehouses, plants,
//   franchise HQs, producers, etc.) — not packaging suppliers.

 /* eslint-disable @typescript-eslint/no-explicit-any */

type Tier = "A" | "B" | "C";

export type Candidate = {
  host: string;              // example.com
  name: string;
  url?: string;              // https://example.com
  city?: string;
  tier?: Tier;               // inferred size (A=large, B=mid, C=small)
  tags?: string[];           // categories/types returned by provider
  provider: "places" | "osm";
  raw?: any;                 // provider blob (optional)
};

const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toHost(url?: string): string | undefined {
  if (!url) return;
  try {
    const h = new URL(url.startsWith("http") ? url : "https://" + url).hostname;
    return h.replace(/^www\./i, "").toLowerCase();
  } catch { return undefined; }
}

function sizeToTier(input?: string): Tier | undefined {
  const s = (input || "").toLowerCase();
  if (!s) return;
  if (s === "large" || s === "l" || s === "a") return "A";
  if (s === "medium" || s === "mid" || s === "m" || s === "b") return "B";
  if (s === "small" || s === "s" || s === "c") return "C";
}

function isActionableHost(h?: string): boolean {
  const host = String(h || "").toLowerCase();
  if (!host) return false;
  // obvious non-sites or directories
  if (host === "maps.google.com" || host.endsWith(".google.com")) return false;
  if (host.endsWith("googleusercontent.com")) return false;
  if (host.endsWith("yelp.com")) return false;
  if (host.endsWith("facebook.com") || host.endsWith("instagram.com")) return false;
  if (host.endsWith("linkedin.com") || host.endsWith("angel.co")) return false;
  if (host.endsWith("glassdoor.com") || host.endsWith("indeed.com")) return false;
  if (host.endsWith("yellowpages.com") || host.endsWith("tripadvisor.com")) return false;
  if (host.endsWith("doordash.com") || host.endsWith("ubereats.com") || host.endsWith("grubhub.com")) return false;
  return true;
}

function dedupeByHost(items: Candidate[], cap: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const it of items) {
    if (!it.host) continue;
    if (seen.has(it.host)) continue;
    seen.add(it.host);
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

function uniqLower(a?: unknown[]): string[] {
  const s = new Set<string>();
  if (Array.isArray(a)) for (const v of a) {
    const t = String(v ?? "").trim().toLowerCase();
    if (t) s.add(t);
  }
  return [...s];
}

/* -------------------------------------------------------------------------- */
/* verticals/families + size overlays                                         */
/* -------------------------------------------------------------------------- */

// Each family contains search phrases that typically identify PACKAGING BUYERS.
// These intentionally span primary + secondary packaging consumption.

const FAMILY: Record<string, string[]> = {
  // Food & beverage production (buyers of corrugate, film, labels, closures…)
  food_mfg: [
    "food manufacturer", "food processing plant", "food plant",
    "co-packer", "contract packager", "private label food",
    "bottling plant", "canning facility", "retort facility",
    "meat processor", "poultry processor", "seafood processor",
    "produce packer", "fresh cut facility", "dairy plant", "cheese factory",
    "snack manufacturer", "frozen foods manufacturer", "meal prep facility",
    "sauce manufacturer", "condiment manufacturer", "bakery plant",
    "candy manufacturer", "chocolate factory"
  ],

  beverage: [
    "beverage manufacturer", "beverage co-packer",
    "brewery", "microbrewery", "cider house",
    "distillery", "craft distillery", "winery", "bottling company",
    "juice bottling", "kombucha brewery", "coffee roastery", "tea factory",
    "soda bottler", "energy drink manufacturer"
  ],

  // E-commerce & fulfillment (mailers, labels, void fill, tape, stretch…)
  ecommerce_3pl: [
    "fulfillment center", "ecommerce fulfillment", "micro fulfillment",
    "third party logistics", "3pl", "order fulfillment", "pick and pack",
    "subscription box company", "merch fulfillment", "print on demand",
    "amazon prep center", "fba prep center", "crowd fulfillment",
    "returns processing center"
  ],

  // Warehousing & distribution (secondary packaging heavy: stretch, shrink, strap)
  logistics_warehouse: [
    "warehouse", "distribution center", "cold storage warehouse",
    "cross dock", "regional distribution center", "last mile hub",
    "freight consolidation", "palletizing service", "public warehouse"
  ],

  // Health/beauty & CPG (cartons, labels, jar/pouch, compliance)
  beauty_personal: [
    "cosmetics manufacturer", "skincare manufacturer", "beauty co-packer",
    "hair care manufacturer", "soap manufacturer", "candle manufacturer",
    "fragrance manufacturer", "lip balm manufacturer", "body care manufacturer",
    "nail polish manufacturer"
  ],

  pharma_nutra: [
    "pharmaceutical manufacturer", "pharma packaging", "compounding pharmacy lab",
    "nutraceutical manufacturer", "vitamin manufacturer", "supplement manufacturer",
    "medical device manufacturer", "sterile packaging lab"
  ],

  cannabis: [
    "cannabis processor", "cannabis manufacturer", "edibles manufacturer",
    "pre-roll manufacturer", "vape manufacturer", "cannabis packaging facility",
    "dispensary chain headquarters"
  ],

  industrial_mfg: [
    "contract manufacturer", "light manufacturing", "assembly plant",
    "machine shop", "metal fabrication", "injection molding",
    "plastic extrusion", "foam fabricator", "gasket manufacturer",
    "chemical manufacturer", "paint manufacturer", "adhesives manufacturer",
    "cleaning products manufacturer", "janitorial products manufacturer"
  ],

  electronics_auto: [
    "electronics assembly", "pcb assembler", "ems provider",
    "semiconductor packaging", "cable assembly", "battery pack assembler",
    "auto parts manufacturer", "aerospace parts manufacturer",
    "aftermarket parts distributor"
  ],

  apparel_merch: [
    "screen printing shop", "embroidery shop", "apparel fulfillment",
    "merch fulfillment", "dtg printing", "garment manufacturer",
    "textile manufacturer", "fashion brand headquarters"
  ],

  pet_agri: [
    "pet food manufacturer", "pet treats manufacturer", "pet supplies e-commerce",
    "animal health manufacturer", "seed company", "produce shipper",
    "packing shed", "nursery grower", "horticulture greenhouse"
  ],

  home_furniture: [
    "furniture manufacturer", "mattress manufacturer", "home goods warehouse",
    "kitchen cabinet manufacturer", "wood products manufacturer"
  ],

  printing_label_kitting: [
    "kitting and assembly", "contract kitting", "promo kitting",
    "subscription box kitting", "label printing in-house", "mail house",
    "direct mail facility", "commercial printer with fulfillment"
  ],

  hospitality_edu_events: [
    "restaurant group headquarters", "franchise headquarters", "catering company",
    "stadium concessions", "venue concessions", "hotel distribution center",
    "university dining services", "school district nutrition services"
  ],
};

// Size overlays (hint words appended to many families when size is requested)
const SIZE_HINT: Record<"small" | "medium" | "large", string[]> = {
  small: [
    "local", "independent", "small batch", "artisan", "micro",
    "family owned", "startup"
  ],
  medium: ["regional", "multi-location", "growing"],
  large: ["corporate", "national", "headquarters", "regional distribution center"]
};

// Product hooks → add/bias certain families
const PRODUCT_HOOKS: Record<string, string[]> = {
  // secondary packaging heavy
  "stretch": ["logistics_warehouse", "ecommerce_3pl", "home_furniture"],
  "stretch film": ["logistics_warehouse", "ecommerce_3pl", "home_furniture"],
  "pallet wrap": ["logistics_warehouse", "ecommerce_3pl"],
  "void fill": ["ecommerce_3pl", "printing_label_kitting", "home_furniture"],
  "bubble": ["ecommerce_3pl", "home_furniture"],
  "mailers": ["ecommerce_3pl", "apparel_merch", "printing_label_kitting"],
  "corrugate": ["ecommerce_3pl", "food_mfg", "industrial_mfg"],
  "corrugated": ["ecommerce_3pl", "food_mfg", "industrial_mfg"],
  "fibc": ["industrial_mfg", "pet_agri", "food_mfg"],
  "bulk bag": ["industrial_mfg", "pet_agri"],
  "labels": ["food_mfg", "beverage", "beauty_personal", "pharma_nutra"],
  "ribbons": ["food_mfg", "beverage"],
  "shrink": ["beverage", "food_mfg", "logistics_warehouse"],
  "shrink film": ["beverage", "food_mfg", "logistics_warehouse"],
  "tape": ["ecommerce_3pl", "logistics_warehouse"],
  "strapping": ["logistics_warehouse", "industrial_mfg"],
  "poly bag": ["food_mfg", "industrial_mfg", "apparel_merch"],
  "pouch": ["food_mfg", "beauty_personal", "cannabis"],
  "bottle": ["beverage", "beauty_personal"],
  "jar": ["beverage", "beauty_personal"],
};

// A broader generic set we ALWAYS include to keep recall high across sizes.
const GENERIC_ALWAYS: string[] = [
  "wholesale distributor", "brand headquarters", "contract manufacturer",
  "co-manufacturer", "private label manufacturer",
  "regional warehouse", "corporate distribution center"
];

/* -------------------------------------------------------------------------- */
/* query builder                                                              */
/* -------------------------------------------------------------------------- */

type Size = "small" | "medium" | "large";
type BuildOpts = {
  size?: Size;
  sectors?: string[];   // free-form (beauty, pharma, ecommerce, etc.)
  products?: string[];  // free-form (stretch, corrugate, mailer, fibc, etc.)
};

function pickFamiliesFromSectors(sectors?: string[]): string[] {
  const s = uniqLower(sectors);
  if (!s.length) return Object.keys(FAMILY); // default: all families
  const out = new Set<string>();

  const map: Record<string, string[]> = {
    food: ["food_mfg", "beverage"],
    beverage: ["beverage", "food_mfg"],
    beer: ["beverage"],
    wine: ["beverage"],
    spirits: ["beverage"],
    ecommerce: ["ecommerce_3pl", "printing_label_kitting", "apparel_merch"],
    logistics: ["logistics_warehouse", "ecommerce_3pl"],
    3pl: ["ecommerce_3pl", "logistics_warehouse"],
    warehouse: ["logistics_warehouse"],
    beauty: ["beauty_personal"],
    cosmetics: ["beauty_personal"],
    personalcare: ["beauty_personal"],
    pharma: ["pharma_nutra"],
    nutraceuticals: ["pharma_nutra"],
    cannabis: ["cannabis"],
    industrial: ["industrial_mfg"],
    electronics: ["electronics_auto"],
    auto: ["electronics_auto"],
    apparel: ["apparel_merch"],
    pet: ["pet_agri"],
    agriculture: ["pet_agri"],
    furniture: ["home_furniture"],
    printing: ["printing_label_kitting"],
    hospitality: ["hospitality_edu_events"],
    education: ["hospitality_edu_events"],
    events: ["hospitality_edu_events"],
  };

  for (const k of s) {
    const fams = map[k] || [];
    if (fams.length) fams.forEach(f => out.add(f));
  }
  // if nothing matched, fall back to all
  return out.size ? [...out] : Object.keys(FAMILY);
}

function familiesFromProducts(products?: string[]): string[] {
  const out = new Set<string>();
  for (const raw of uniqLower(products)) {
    for (const key of Object.keys(PRODUCT_HOOKS)) {
      if (raw.includes(key)) {
        for (const fam of PRODUCT_HOOKS[key]) out.add(fam);
      }
    }
  }
  return [...out];
}

function buildQueries(opts: BuildOpts): string[] {
  const famBase = new Set<string>(pickFamiliesFromSectors(opts.sectors));
  // product hooks can add more families
  for (const f of familiesFromProducts(opts.products)) famBase.add(f);

  const phrases = new Set<string>(GENERIC_ALWAYS);
  for (const fam of famBase) {
    for (const q of (FAMILY[fam] || [])) phrases.add(q);
  }

  // Size hints: apply by concatenating “hint + phrase” (keeps recall wide)
  const hints = opts.size ? SIZE_HINT[opts.size] : [];
  const out = new Set<string>();

  if (hints.length) {
    for (const p of phrases) {
      out.add(p);
      for (const h of hints) out.add(`${h} ${p}`);
    }
  } else {
    for (const p of phrases) out.add(p);
  }

  // return ~200+ phrases but the fetchers will cap via limit & dedupe
  return [...out];
}

/* -------------------------------------------------------------------------- */
/* providers                                                                  */
/* -------------------------------------------------------------------------- */

const PLACES_DETAILS_MAX = Math.max(
  0,
  Number(process.env.PLACES_DETAILS_MAX ?? process.env.PLACES_DETAILS_LIMIT ?? 8) || 8
);

async function placesSearch(q: string, city?: string, limit = 30): Promise<any[]> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const query = encodeURIComponent(city ? `${q} near ${city}` : q);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${key}`;
  const r = await F(url).catch(() => null);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray((data as any)?.results) ? (data as any).results.slice(0, limit) : [];
}

async function placesDetails(place_id: string): Promise<{ website?: string } | null> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !place_id) return null;
  const fields = "website,url";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=${fields}&key=${key}`;
  const r = await F(url).catch(() => null);
  if (!r?.ok) return null;
  const data = await r.json().catch(() => ({}));
  const site = (data as any)?.result?.website || (data as any)?.result?.url;
  return { website: site };
}

async function fromGoogle(qs: string[], city: string | undefined, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let detailsLookups = 0;

  for (const q of qs) {
    const res = await placesSearch(q, city, Math.ceil(limit * 1.5));
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if ((r as any)?.business_status === "CLOSED_PERMANENTLY") continue;

      let website: string | undefined = (r as any)?.website; // usually undefined in Text Search
      if (!website && (r as any)?.place_id && detailsLookups < PLACES_DETAILS_MAX) {
        try {
          const det = await placesDetails((r as any).place_id);
          website = det?.website;
        } catch { /* ignore */ }
        detailsLookups++;
      }

      const host = toHost(website);
      if (!host || !isActionableHost(host)) continue;

      out.push({
        provider: "places",
        name: (r as any)?.name || "",
        url: website,
        host,
        city: (r as any)?.formatted_address || "",
        tags: Array.isArray((r as any)?.types) ? (r as any).types.slice(0, 6) : [],
        tier: undefined,
        raw: undefined,
      });

      if (out.length >= limit * 2) break; // we'll dedupe + cap later
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

async function osmSearch(q: string, city?: string, limit = 40): Promise<any[]> {
  const query = encodeURIComponent(city ? `${q} near ${city}` : q);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${query}&limit=${limit}`;
  const r = await F(url, { headers: { "User-Agent": "galactly-buyer-finder/1.0" } }).catch(() => null);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function fromOSM(qs: string[], city: string | undefined, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const q of qs) {
    const res = await osmSearch(q, city, Math.ceil(limit * 1.5));
    for (const r of res) {
      const name = (r as any)?.display_name?.split(",")[0] || (r as any)?.namedetail?.name || "Business";
      const site = (r as any)?.extratags?.website || (r as any)?.extratags?.contact_website || (r as any)?.extratags?.url;
      const host = toHost(site);
      if (!host || !isActionableHost(host)) continue;

      out.push({
        provider: "osm",
        name,
        url: site,
        host,
        city: (r as any)?.display_name || "",
        tags: Object.keys((r as any)?.extratags || {}).slice(0, 6),
        tier: undefined,
        raw: undefined,
      });
      if (out.length >= limit * 2) break;
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function findBuyersFromWeb(opts: {
  hostSeed: string;
  city?: string;
  size?: "small" | "medium" | "large";
  limit: number;
  queries?: string[];     // hard override (rare)
  sectors?: string[];     // NEW: bias vertical families
  products?: string[];    // NEW: bias via packaging SKUs (stretch, corrugate, etc.)
}): Promise<Candidate[]> {
  // Build the phrase set: custom > builder(size/sectors/products)
  const sizeTier = sizeToTier(opts.size);
  const qs = (opts.queries && opts.queries.length)
    ? opts.queries
    : buildQueries({ size: opts.size as any, sectors: opts.sectors, products: opts.products });

  // Providers
  const results: Candidate[] = [];
  const gp = await fromGoogle(qs, opts.city, opts.limit).catch(() => []);
  results.push(...gp);

  if (results.length < Math.max(1, opts.limit)) {
    const os = await fromOSM(qs, opts.city, opts.limit).catch(() => []);
    results.push(...os);
  }

  // Attach size tier hint if requested
  for (const r of results) if (sizeTier && !r.tier) r.tier = sizeTier;

  // Keep only actionable, dedupe by host, cap
  const normalized = results.filter(r => !!r.host && isActionableHost(r.host));
  return dedupeByHost(normalized, Math.max(1, opts.limit));
}

export default { findBuyersFromWeb };