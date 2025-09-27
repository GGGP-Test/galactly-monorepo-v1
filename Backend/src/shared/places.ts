// src/shared/places.ts
// Google Places discovery -> BuyerRow[]
// - Text Search by "<category> in <city>"
// - Details call per result to get website
// - Returns tier "C" rows with tags/segments and cityTags
//
// Env: GOOGLE_PLACES_API_KEY
// Notes: kept small, no external deps, light in-memory TTL cache.

import type { BuyerRow } from "./catalog";

const BASE = "https://maps.googleapis.com/maps/api/place";

type PlacesTextResult = {
  results: Array<{
    place_id: string;
    name: string;
    types?: string[];
    formatted_address?: string;
  }>;
  status: string;
  next_page_token?: string;
};

type PlaceDetails = {
  result?: {
    name?: string;
    website?: string;
    types?: string[];
  };
  status: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Robust host normalizer
function normHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Use global fetch but avoid DOM typings noise
const _fetch: any = (globalThis as any).fetch;

// 15-min TTL cache to spare quota + speed up UI retries
const CACHE = new Map<string, { at: number; rows: BuyerRow[] }>();
const TTL_MS = 15 * 60 * 1000;

export interface PlacesOpts {
  city: string;            // e.g. "los angeles"
  categories?: string[];   // e.g. ["coffee shop","bakery"]
  limit?: number;          // number of sites with websites to return
}

/**
 * Fetch small-business websites in a city and map to BuyerRow[].
 * Defaults to SMB retail/food-ish categories that buy packaging.
 */
export async function fetchPlacesBuyers(opts: PlacesOpts): Promise<BuyerRow[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || "";
  if (!apiKey) return [];

  const city = String(opts.city || "").trim();
  if (!city) return [];

  const categories =
    (opts.categories && opts.categories.length
      ? opts.categories
      : [
          "coffee shop",
          "cafe",
          "tea shop",
          "bakery",
          "chocolate shop",
          "candy store",
          "pet store",
          "natural foods store",
          "grocery store",
          "juice bar",
          "ice cream shop",
          "delicatessen",
        ]).map((s) => s.trim());

  const want = Math.max(1, Math.min(100, opts.limit ?? 25));
  const cacheKey = `${city}::${categories.join("|")}::${want}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const rows: BuyerRow[] = [];
  const seen = new Set<string>();

  for (const cat of categories) {
    if (rows.length >= want) break;

    const q = encodeURIComponent(`${cat} in ${city}`);
    const baseUrl = `${BASE}/textsearch/json?query=${q}&key=${apiKey}`;
    let pageUrl = baseUrl;

    // Up to 2 pages per category for speed/quota
    for (let page = 0; page < 2 && rows.length < want; page++) {
      const r = await _fetch(pageUrl);
      const data = (await r.json()) as PlacesTextResult;
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") break;

      for (const item of data.results) {
        if (rows.length >= want) break;

        // Need Details to get website
        const dUrl = `${BASE}/details/json?place_id=${encodeURIComponent(
          item.place_id,
        )}&fields=name,website,types&key=${apiKey}`;

        const dr = await _fetch(dUrl);
        const det = (await dr.json()) as PlaceDetails;
        const website = (det.result?.website || "").trim();
        const host = normHost(website);
        if (!host || seen.has(host)) continue;
        seen.add(host);

        const types = [
          ...(det.result?.types || []),
          ...(item.types || []),
          cat.toLowerCase(),
        ]
          .map(String)
          .filter(Boolean);

        rows.push({
          host,
          name: det.result?.name || item.name || host,
          tiers: ["C"], // Places results skew SMB → Tier C
          segments: Array.from(new Set(types)),
          tags: Array.from(new Set(types)),
          cityTags: [city.toLowerCase()],
          platform: "web",
        });
      }

      if (!data.next_page_token) break;
      // Next page token requires a short delay
      await sleep(1500);
      pageUrl = `${baseUrl}&pagetoken=${encodeURIComponent(
        data.next_page_token,
      )}`;
    }
  }

  const out = rows.slice(0, want);
  CACHE.set(cacheKey, { at: Date.now(), rows: out });
  return out;
}