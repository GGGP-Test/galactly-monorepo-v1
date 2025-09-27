// src/routes/places.ts
//
// Real-buyer finder via Google Places (Text Search + Details).
// - GET /api/places/search?q=bakery&city=los%20angeles&limit=10
// - Requires: process.env.GOOGLE_PLACES_API_KEY
// - No external deps; uses Node 18/20 fetch
//
// Notes:
// • Only returns places that expose a real website URL.
// • Designed to find Tier-C/small retail/food/boutique first.
// • Safe defaults + tiny in-memory cache (TTL configurable).

import { Router, Request, Response } from "express";

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || "";
const CACHE_TTL_S = Number(process.env.CACHE_TTL_S || 600);
const MAX_DETAILS_PER_REQ = Math.max(1, Math.min(25, Number(process.env.MAX_PROBES_PER_FIND_FREE || 20)));

const r = Router();

type Maybe<T> = T | null | undefined;

interface PlaceBasic {
  place_id: string;
  name?: string;
  business_status?: string;
  types?: string[];
  formatted_address?: string;
}

interface PlaceDetails {
  website?: string;
  name?: string;
  types?: string[];
  formatted_address?: string;
}

interface FoundBuyer {
  host: string;
  name: string;
  tiers: string[];       // e.g., ["C"]
  tags: string[];        // normalized
  cityTags: string[];    // normalized city
  segments: string[];    // e.g., ["food","retail","cafe"]
}

// --- tiny utils ---

function norm(s: Maybe<string>): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hostFromUrl(url: string): string | undefined {
  try {
    const h = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .trim();
    return h || undefined;
  } catch {
    return undefined;
  }
}

function uniqLower(xs: Maybe<string[]>): string[] {
  const out = new Set<string>();
  for (const x of xs || []) {
    const v = norm(x);
    if (v) out.add(v);
  }
  return [...out];
}

// map Google types → our coarse segments/tags
function segmentsFromTypes(types: string[] = []): string[] {
  const t = new Set(types.map(norm));
  const seg = new Set<string>();

  // food / beverage
  if (t.has("cafe") || t.has("coffee_shop") || t.has("bakery") || t.has("restaurant")) {
    seg.add("food");
    seg.add("retail");
  }

  // boutique / retail-ish
  if (t.has("store") || t.has("clothing_store") || t.has("home_goods_store") || t.has("convenience_store")) {
    seg.add("retail");
  }

  // crafts / beauty / local services hints → still retail-ish for our purposes
  if (t.has("beauty_salon") || t.has("hair_care") || t.has("jewelry_store") || t.has("florist")) {
    seg.add("retail");
  }

  return [...seg];
}

function baseTags(types: string[] = []): string[] {
  const tags = new Set<string>();
  for (const t of types) tags.add(norm(t).replace(/_/g, " "));
  return [...tags];
}

// --- very small in-memory cache ---

const CACHE = new Map<
  string,
  { expiresAt: number; data: any }
>();

function cacheKey(kind: string, params: Record<string, any>): string {
  return `${kind}:${Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&")}`;
}

function cacheGet(key: string): any | undefined {
  const hit = CACHE.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    CACHE.delete(key);
    return undefined;
  }
  return hit.data;
}

function cacheSet(key: string, data: any, ttlSec = CACHE_TTL_S) {
  CACHE.set(key, { data, expiresAt: Date.now() + ttlSec * 1000 });
}

// --- Google API calls ---

async function textSearch(query: string): Promise<PlaceBasic[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", PLACES_KEY);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`textsearch http ${res.status}`);
  const body = await res.json();
  const status = String(body?.status || "");
  if (status !== "OK" && status !== "ZERO_RESULTS") {
    throw new Error(`textsearch status ${status}`);
  }

  const results = Array.isArray(body?.results) ? body.results : [];
  return results.map((r: any) => ({
    place_id: String(r.place_id || ""),
    name: r.name ? String(r.name) : undefined,
    business_status: r.business_status ? String(r.business_status) : undefined,
    types: Array.isArray(r.types) ? r.types.map(String) : [],
    formatted_address: r.formatted_address ? String(r.formatted_address) : undefined,
  }));
}

async function placeDetails(placeId: string): Promise<PlaceDetails> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  // Ask only for what we need to keep it cheap.
  url.searchParams.set("fields", "name,website,types,formatted_address");
  url.searchParams.set("key", PLACES_KEY);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`details http ${res.status}`);
  const body = await res.json();
  const status = String(body?.status || "");
  if (status !== "OK") throw new Error(`details status ${status}`);

  const r = body?.result || {};
  return {
    website: r.website ? String(r.website) : undefined,
    name: r.name ? String(r.name) : undefined,
    types: Array.isArray(r.types) ? r.types.map(String) : [],
    formatted_address: r.formatted_address ? String(r.formatted_address) : undefined,
  };
}

// --- Route: /api/places/search ---

r.get("/search", async (req: Request, res: Response) => {
  try {
    if (!PLACES_KEY) {
      return res.status(200).json({
        ok: false,
        error: "missing-places-key",
        detail: "Set GOOGLE_PLACES_API_KEY in the environment.",
        items: [],
      });
    }

    const q = norm(String(req.query.q || "packaging friendly cafe"));
    const cityRaw = String(req.query.city || "");
    const city = norm(cityRaw);
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));

    if (!city) {
      return res.status(400).json({ ok: false, error: "missing-city", items: [] });
    }

    // Build a single conservative query first; we can expand later if needed.
    const query = `${q} in ${city}`;
    const ck = cacheKey("textsearch", { q, city });

    let basics: PlaceBasic[] | undefined = cacheGet(ck);
    if (!basics) {
      basics = await textSearch(query);
      cacheSet(ck, basics);
    }

    // Keep only operational candidates; then fetch details for a small subset.
    const candidates = basics
      .filter((b) => (b.business_status || "").toUpperCase() === "OPERATIONAL")
      .slice(0, MAX_DETAILS_PER_REQ);

    const out: FoundBuyer[] = [];
    for (const c of candidates) {
      if (!c.place_id) continue;

      // Details may hit cache too
      const dk = cacheKey("details", { id: c.place_id });
      let det: PlaceDetails | undefined = cacheGet(dk);
      if (!det) {
        try {
          det = await placeDetails(c.place_id);
          cacheSet(dk, det);
        } catch {
          continue; // skip noisy ones
        }
      }

      const host = det?.website ? hostFromUrl(det.website) : undefined;
      if (!host) continue;

      const types = uniqLower([...(c.types || []), ...((det?.types || []).map(String))]);
      const segs = segmentsFromTypes(types);
      const tags = uniqLower([...baseTags(types), q]);

      out.push({
        host,
        name: det?.name || c.name || host,
        tiers: ["C"],
        tags,
        cityTags: [city],
        segments: segs,
      });

      if (out.length >= limit) break;
    }

    return res.json({ ok: true, items: out });
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      error: "places-search-failed",
      detail: String(err?.message || err),
      items: [],
    });
  }
});

export default r;