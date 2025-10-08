// src/shared/sources.ts
//
// Web-first buyer discovery (hardened + expanded).
// - Google Places Text Search + optional Details (if PLACES_API_KEY is set)
// - Fallback to OpenStreetMap Nominatim (no key)
// - Size-aware + vertical-aware default queries (micro/small/mid/large)
// - Covers primary, secondary and tertiary packaging buyers
// - Filters non-actionable hosts (maps.google, yelp, facebook, instagram)
// - Limits Places Details lookups to avoid quota burn
// - Normalizes to Candidate shape
//
// Notes:
// • All query tokens are quoted (even those starting with digits like "3pl").
// • If you pass opts.queries, those override the generated defaults.
// • Keep query lists modest(ish); we still overfetch and dedupe strictly.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tier = "A" | "B" | "C";

export type Candidate = {
  host: string;              // example.com
  name: string;
  url?: string;              // https://example.com
  city?: string;
  tier?: Tier;               // inferred size (A=large, B=mid, C=small)
  tags?: string[];           // categories/types from provider
  provider: "places" | "osm";
  raw?: any;                 // provider blob (optional)
};

const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

/* -------------------------------------------------------------------------- */
/* Query lexicon (evergreen, safe to extend)                                   */
/* -------------------------------------------------------------------------- */

/** Micro / Small buyers (high count, often primary/secondary, low-medium AOV) */
const Q_MICRO_SMALL: string[] = [
  // foodservice & beverage (primary + some secondary)
  "cafe","coffee shop","bakery","cupcake shop","donut shop","gelato shop",
  "ice cream shop","juice bar","tea shop","boba tea","sandwich shop",
  "delicatessen","restaurant","pizzeria","food truck","caterer","meal prep",
  "ghost kitchen","butcher shop","seafood market","greengrocer",
  "grocery","corner store","mini market","convenience store","farm stand",
  "farmers market vendor",
  // CPG micro brands & ecom
  "coffee roaster","micro roastery","artisan chocolate","candy shop",
  "snack brand","baked goods brand","sauce company","hot sauce brand",
  "jam and preserves","condiments brand","spice company",
  "tea brand","supplement brand","vitamin brand","niche cosmetics brand",
  "candle company","soap company","etsy shop","small ecommerce brand",
  // fulfillment / shipping lite
  "shipping store","pack and ship","print and ship",
  "mailing center","independent bookstore",
  // industrial-lite / maintenance buyers
  "machine shop","print shop","screen printing","t-shirt printing",
  "craft brewery taproom","nano brewery",
  // warehousing / tertiary even when small
  "small warehouse","micro warehouse","micro fulfillment","self storage business",
  "local 3pl","local third party logistics","parcel fulfillment center",
  // misc retail that consumes secondary packaging
  "pet boutique","pet store","health food store","natural foods store",
  "bottle shop","wine shop","liquor store","vape shop","dispensary",
];

/** Mid-size buyers (secondary + tertiary heavy; higher AOV; regional ops) */
const Q_MID: string[] = [
  // food & beverage processing / wholesale
  "wholesale bakery","commissary kitchen","food manufacturer","snack manufacturer",
  "frozen foods plant","meat processor","seafood processor",
  "dairy processor","cheese manufacturer","coffee roastery","coffee distributor",
  "tea importer","beverage co-packer","craft brewery","brewery production",
  "distillery production","winery production","bottling line",
  // health & beauty, pharma-lite
  "cosmetics manufacturer","skincare manufacturer","contract manufacturer cosmetics",
  "nutraceutical manufacturer","supplement manufacturer","vitamin packager",
  "personal care manufacturer",
  // ecom ops / fulfillment / 3PL
  "ecommerce fulfillment center","order fulfillment center",
  "regional 3pl","third party logistics","returns center","kitting center",
  "co-packer","contract packager","repackaging service",
  // general distribution & wholesale
  "food distributor","beverage distributor","wholesale foods","wholesale beverage",
  "produce distributor","meat distributor","seafood distributor",
  "dairy distributor","frozen distributor","broadline distributor",
  // warehousing / logistics
  "distribution center","cross dock","cold storage warehouse",
  "temperature controlled warehouse","ambient warehouse","bonded warehouse",
  // retail chains / multi-unit buyers
  "regional grocery chain","regional convenience store chain",
  "regional restaurant chain","franchise operator",
  // manufacturing segments that burn stretch/shrink/void/tape
  "pet food manufacturer","household goods manufacturer",
  "electronics assembly","medical device assembly",
  "apparel fulfillment","shoe fulfillment",
  // misc
  "printing and labeling service","label converter","flexographic printer",
];

/** Large buyers (A-tier; tertiary heavy; high velocity and pallet volume) */
const Q_LARGE: string[] = [
  // large manufacturing & DCs
  "national distribution center","mega distribution center",
  "automotive parts manufacturer","appliance manufacturer",
  "electronics manufacturer","medical device manufacturer",
  "pharmaceutical distribution center","national grocery distribution",
  "big box retail distribution center","omnichannel fulfillment center",
  "third party logistics campus","national 3pl","ecommerce mega fulfillment",
  "cold chain logistics hub","high-bay warehouse",
  // co-pack & industrial packaging
  "contract packaging facility","high speed bottling","beverage bottling plant",
  "food processing plant","large meat processing plant","poultry processing plant",
  "confectionery factory","dairy processing plant",
  // heavy film & load secure consumers
  "palletizing operation","automated stretch wrap line","shrink tunnel line",
  "case packing line","form fill seal line","thermoforming line",
  // bulk bags / sacks
  "grain elevator","bulk commodity terminal","chemical distributor",
  "bulk bag user","fibc bulk bag user",
];

/** Cross-vertical product-intent overlays (used across sizes) */
const Q_PRODUCT_OVERLAYS: string[] = [
  "stretch film","stretch wrap","pallet wrap","hand wrap","machine wrap",
  "shrink film","shrink wrap","shrink tunnel","heat tunnel",
  "void fill","air pillows","bubble wrap","foam-in-place","packing peanuts",
  "tape dispenser","tape gun","case tape","strapping","strapping machine",
  "palletizing","pallet banding",
  "poly bag","poly mailer","mailer bag","zipper pouch","stand up pouch",
  "labels and printing","thermal labels","ribbon printing","label applicator",
  "corrugated boxes","custom corrugate","mailers","box supplier",
  "fibc bulk bags","bulk sacks","drum liners",
  "packaging automation","carton erector","case sealer",
  "conveyor system","weighing and filling","form fill seal",
];

/** Alias for tiny users who select “micro” (maps to Tier C too). */
const Q_MICRO_ONLY: string[] = [
  "home bakery","cottage bakery","home-based food business",
  "farmers market seller","etsy seller","craft seller","cottage foods",
];

/** Combine a size with overlays. We keep this intentionally simple and safe. */
function queriesForSize(size?: "micro"|"small"|"medium"|"large"): string[] {
  const base =
    size === "large"  ? Q_LARGE :
    size === "medium" ? Q_MID :
    size === "micro"  ? Q_MICRO_ONLY.concat(Q_MICRO_SMALL) :
                        Q_MICRO_SMALL; // default small
  // Include product-intent overlays (helps find secondary/tertiary users)
  const blended = base.concat(Q_PRODUCT_OVERLAYS);
  // Dedup + cap to keep Text Search reasonable
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of blended) {
    const s = String(q || "").trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 80) break; // guardrail: keep it tight(ish)
  }
  return out;
}

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
  if (s === "small" || s === "s" || s === "c" || s === "micro") return "C";
}

function isActionableHost(h?: string): boolean {
  const host = String(h || "").toLowerCase();
  if (!host) return false;
  if (host === "maps.google.com" || host.endsWith(".google.com")) return false;
  if (host.endsWith("yelp.com")) return false;
  if (host.endsWith("facebook.com") || host.endsWith("instagram.com")) return false;
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

/* -------------------------------------------------------------------------- */
/* Google Places                                                              */
/* -------------------------------------------------------------------------- */

const PLACES_DETAILS_MAX = Math.max(
  0,
  Number(process.env.PLACES_DETAILS_MAX ?? process.env.PLACES_DETAILS_LIMIT ?? 8) || 8
);

async function placesSearch(q: string, city?: string, limit = 30): Promise<any[]> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const query = encodeURIComponent(city ? (q + " near " + city) : q);
  const url = "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" + query + "&key=" + key;
  const r = await F(url).catch(() => null);
  if (!r || !r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray((data as any).results) ? (data as any).results.slice(0, limit) : [];
}

async function placesDetails(place_id: string): Promise<{ website?: string } | null> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !place_id) return null;
  const fields = "website,url";
  const url = "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
              encodeURIComponent(place_id) + "&fields=" + fields + "&key=" + key;
  const r = await F(url).catch(() => null);
  if (!r || !r.ok) return null;
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
      if ((r && r.business_status) === "CLOSED_PERMANENTLY") continue;

      let website: string | undefined = (r as any)?.website; // usually undefined in Text Search
      if (!website && r && r.place_id && detailsLookups < PLACES_DETAILS_MAX) {
        try {
          const det = await placesDetails(r.place_id);
          website = det ? det.website : undefined;
        } catch { /* ignore */ }
        detailsLookups++;
      }

      const host = toHost(website);
      if (!host || !isActionableHost(host)) continue;

      out.push({
        provider: "places",
        name: (r && r.name) ? r.name : "",
        url: website,
        host,
        city: (r && r.formatted_address) ? r.formatted_address : "",
        tags: Array.isArray((r && r.types) ? r.types : []) ? (r.types as string[]).slice(0, 6) : [],
        tier: undefined,
        raw: undefined
      });

      if (out.length >= limit * 2) break; // we'll dedupe + cap later
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* OpenStreetMap                                                              */
/* -------------------------------------------------------------------------- */

async function osmSearch(q: string, city?: string, limit = 40): Promise<any[]> {
  const query = encodeURIComponent(city ? (q + " near " + city) : q);
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&q=" + query + "&limit=" + String(limit);
  const r = await F(url, { headers: { "User-Agent": "buyers-finder/1.0" } }).catch(() => null);
  if (!r || !r.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function fromOSM(qs: string[], city: string | undefined, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const q of qs) {
    const res = await osmSearch(q, city, Math.ceil(limit * 1.5));
    for (const r of res) {
      const name = (r && r.display_name) ? String(r.display_name).split(",")[0] : (r && r.namedetail && r.namedetail.name) ? r.namedetail.name : "Business";
      const site = (r && r.extratags && (r.extratags.website || r.extratags.contact_website || r.extratags.url)) ? (r.extratags.website || r.extratags.contact_website || r.extratags.url) : undefined;
      const host = toHost(site);
      if (!host || !isActionableHost(host)) continue;

      const tags = r && r.extratags ? Object.keys(r.extratags) : [];
      out.push({
        provider: "osm",
        name,
        url: site,
        host,
        city: (r && r.display_name) ? r.display_name : "",
        tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
        tier: undefined,
        raw: undefined
      });
      if (out.length >= limit * 2) break;
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function findBuyersFromWeb(opts: {
  hostSeed: string;
  city?: string;
  size?: "micro" | "small" | "medium" | "large";
  limit: number;
  queries?: string[];
}): Promise<Candidate[]> {
  const sizeTier = sizeToTier(opts.size);
  const qs = (opts.queries && opts.queries.length ? opts.queries : queriesForSize(opts.size));

  const results: Candidate[] = [];
  const gp = await fromGoogle(qs, opts.city, opts.limit).catch(() => []);
  results.push(...gp);

  if (results.length < opts.limit) {
    const os = await fromOSM(qs, opts.city, opts.limit).catch(() => []);
    results.push(...os);
  }

  // Attach size tier hint if requested
  if (sizeTier) for (const r of results) if (!r.tier) r.tier = sizeTier;

  // Keep only actionable, dedup by host, cap
  const normalized = results.filter(r => !!r.host && isActionableHost(r.host));
  return dedupeByHost(normalized, Math.max(1, opts.limit));
}

export default { findBuyersFromWeb };