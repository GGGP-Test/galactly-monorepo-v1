// src/shared/sources.ts
//
// Web-first buyer discovery.
// - Google Places Text Search + optional Details (if PLACES_API_KEY is set)
// - Fallback to OpenStreetMap Nominatim (no key)
// - Normalizes to a shared Candidate shape

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
  raw?: any;                 // provider blob (for debugging)
};

const F: (u: string, i?: any) => Promise<any> = (globalThis as any).fetch;

const DEFAULT_QUERIES = [
  "cafe", "coffee shop", "bakery", "delicatessen",
  "restaurant", "juice bar", "tea shop",
  "grocery", "convenience store", "candy shop",
  "ice cream shop", "beverage store"
];

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

/* -------------------------- Google Places -------------------------- */

async function placesSearch(q: string, city?: string, limit = 30): Promise<any[]> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return [];
  const query = encodeURIComponent(city ? `${q} near ${city}` : q);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${key}`;
  const r = await F(url);
  if (!r?.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
}

async function placesDetails(place_id: string): Promise<{ website?: string } | null> {
  const key = process.env.PLACES_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const fields = "website,url";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=${fields}&key=${key}`;
  const r = await F(url);
  if (!r?.ok) return null;
  const data = await r.json().catch(() => ({}));
  const site = data?.result?.website || data?.result?.url;
  return { website: site };
}

async function fromGoogle(qs: string[], city: string | undefined, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const q of qs) {
    const res = await placesSearch(q, city, Math.ceil(limit * 1.5));
    for (const r of res) {
      if (r?.business_status === "CLOSED_PERMANENTLY") continue;
      let website: string | undefined = r?.website;
      if (!website && r?.place_id) {
        // Shallow details for a handful near the top; keep it light
        try { website = (await placesDetails(r.place_id))?.website; } catch {}
      }
      const host = toHost(website);
      out.push({
        provider: "places",
        name: r?.name || "",
        url: website,
        host: host || "",
        city: r?.formatted_address || "",
        tags: Array.isArray(r?.types) ? r.types.slice(0, 6) : [],
        tier: undefined,
        raw: undefined
      });
      if (out.length >= limit * 2) break; // we’ll dedupe & cap later
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

/* ------------------------- OpenStreetMap --------------------------- */

async function osmSearch(q: string, city?: string, limit = 40): Promise<any[]> {
  const query = encodeURIComponent(city ? `${q} near ${city}` : q);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${query}&limit=${limit}`;
  const r = await F(url, { headers: { "User-Agent": "galactly-buyer-finder/1.0" } });
  if (!r?.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

async function fromOSM(qs: string[], city: string | undefined, limit: number): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const q of qs) {
    const res = await osmSearch(q, city, Math.ceil(limit * 1.5));
    for (const r of res) {
      const name = r?.display_name?.split(",")[0] || r?.namedetail?.name || "Business";
      const site = r?.extratags?.website || r?.extratags?.contact_website || r?.extratags?.url;
      const host = toHost(site);
      out.push({
        provider: "osm",
        name,
        url: site,
        host: host || "",
        city: r?.display_name || "",
        tags: Object.keys(r?.extratags || {}).slice(0, 6),
        tier: undefined,
        raw: undefined
      });
      if (out.length >= limit * 2) break;
    }
    if (out.length >= limit * 2) break;
  }
  return out;
}

/* -------------------------- Public API ---------------------------- */

export async function findBuyersFromWeb(opts: {
  hostSeed: string;
  city?: string;
  size?: "small" | "medium" | "large";
  limit: number;
  queries?: string[];
}): Promise<Candidate[]> {
  const sizeTier = sizeToTier(opts.size);
  const qs = (opts.queries && opts.queries.length ? opts.queries : DEFAULT_QUERIES);

  const results: Candidate[] = [];
  const gp = await fromGoogle(qs, opts.city, opts.limit).catch(() => []);
  results.push(...gp);
  if (results.length < opts.limit) {
    const os = await fromOSM(qs, opts.city, opts.limit).catch(() => []);
    results.push(...os);
  }

  // Attach size tier hint if requested
  for (const r of results) if (sizeTier && !r.tier) r.tier = sizeTier;

  // host may be missing for some OSM rows; keep only those we can outreach
  const normalized = results
    .map(r => r.host ? r : { ...r, host: r.host })
    .filter(r => !!r.host);

  return dedupeByHost(normalized, Math.max(1, opts.limit));
}