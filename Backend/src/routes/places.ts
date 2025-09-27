// Lightweight Google Places search with caching + cost guardrails.
// GET /api/places/search?q=coffee shop&city=los angeles&limit=5
//
// - Uses in-process TTL cache to reduce paid calls
// - Applies daily cap per client (IP or x-api-key)
// - Gentle degrade on quota/rate hit (200 with ok:false, items:[])
// - No extra deps; uses global fetch (Node 18/20)

import { Router, Request, Response } from "express";
import { CFG, capResults } from "../shared/env";
// If you saved the helper as "guard.ts", change the next line to "../shared/guard"
import { withCache, daily, rate } from "../shared/guards";

const r = Router();

// Explicitly type fetch to keep TS happy without DOM lib types.
const F: (input: any, init?: any) => Promise<any> = (globalThis as any).fetch;

// ---------- small helpers ----------
function q(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown> | undefined)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function clientKey(req: Request): string {
  // prefer caller-provided key; fallback to IP
  const apiKey = (req.headers["x-api-key"] || "") as string;
  const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
  return apiKey ? `k:${apiKey}` : `ip:${ip}`;
}

function toHost(url: string | undefined): string {
  try {
    if (!url) return "";
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (url || "").toLowerCase();
  }
}

function asStr(v: unknown): string {
  return (v == null ? "" : String(v)).trim();
}

function uniq<T>(arr: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const a of arr) {
    const k = JSON.stringify(a);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

// ---------- Google helpers ----------
interface GTextSearchResult {
  place_id: string;
  types?: string[];
  // address components not needed here
}

interface GTextSearchResponse {
  results?: GTextSearchResult[];
  status?: string;
  error_message?: string;
}

interface GDetailsResult {
  website?: string;
  name?: string;
  types?: string[];
}

interface GDetailsResponse {
  result?: GDetailsResult;
  status?: string;
  error_message?: string;
}

async function googleTextSearch(query: string, key: string): Promise<GTextSearchResult[]> {
  const url =
    "https://maps.googleapis.com/maps/api/place/textsearch/json?" +
    new URLSearchParams({
      query,
      // region/ language hints could be added later if needed
      key,
    }).toString();

  const res = await F(url);
  const data = (await res.json()) as GTextSearchResponse;
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`places textsearch: ${data.status} ${data.error_message || ""}`.trim());
  }
  return data.results || [];
}

async function googleDetails(placeId: string, key: string): Promise<GDetailsResult | undefined> {
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json?" +
    new URLSearchParams({
      place_id: placeId,
      // Request only fields we need to keep costs low.
      // (Fields billing only applies to Places *new* API; classic details uses status-based billing.)
      fields: "website,name,types",
      key,
    }).toString();

  const res = await F(url);
  const data = (await res.json()) as GDetailsResponse;
  if (data.status && data.status !== "OK") {
    // Do not throw on NOT_FOUND/etc., just skip this record.
    return undefined;
  }
  return data.result;
}

// ---------- route ----------
r.get("/search", async (req: Request, res: Response) => {
  try {
    if (!CFG.googlePlacesApiKey) {
      return res
        .status(200)
        .json({ ok: false, items: [], error: "places-disabled", detail: "missing api key" });
    }

    const rawQ = q(req, "q") || "";
    const city = q(req, "city") || "";
    const wantLimit = Number(q(req, "limit"));
    const baseLimit =
      Number.isFinite(wantLimit) && wantLimit > 0 ? Math.floor(wantLimit) : CFG.placesLimitDefault;

    // Treat this endpoint as "free plan" by default for caps; can be switched later per key.
    const outCap = capResults(false /* isPro */, baseLimit);

    // ---- guardrails: daily + simple burst gate
    const who = clientKey(req);
    const dailyLimit = Math.max(1, CFG.freeClicksPerDay || 25);
    const day = daily.allow(`places:${who}`, dailyLimit);
    if (!day.ok) {
      return res.status(200).json({
        ok: false,
        items: [],
        error: "daily-quota-exceeded",
      });
    }

    const burst = rate.allow(`places:${who}`, 5 /* per window */, 10_000 /* ms */);
    if (!burst.ok) {
      return res.status(200).json({
        ok: false,
        items: [],
        error: "rate-limited",
        retryInMs: burst.resetInMs,
      });
    }

    // Build the text search query (keep it simple: "<q> <city>")
    const query = [rawQ, city].filter(Boolean).join(" ").trim();
    if (!query) {
      return res.status(200).json({ ok: true, items: [] });
    }

    const cacheKey = `places:${query}:cap${outCap}`;
    const ttlMs = Math.max(5, CFG.cacheTtlS || 300) * 1000;

    const items = await withCache(cacheKey, ttlMs, async () => {
      // 1) text search
      const results = await googleTextSearch(query, CFG.googlePlacesApiKey!);

      // 2) take the top slice we'll attempt details for (cap)
      const take = results.slice(0, outCap);

      // 3) hydrate details in parallel (website, name, types)
      const details = await Promise.all(
        take.map((r) => googleDetails(r.place_id, CFG.googlePlacesApiKey!)),
      );

      // 4) map into our FreePanel item shape
      const cityTag = city.toLowerCase();
      const itemsMapped = details
        .map((d) => {
          if (!d) return undefined;
          const host = toHost(d.website);
          if (!host) return undefined; // skip if no real website
          const name = asStr(d.name);
          const types = Array.isArray(d.types) ? d.types : [];
          // Very light normalization
          const tags = uniq(
            types
              .map((t) => t.toLowerCase())
              .filter((t) => t && t !== "point_of_interest") // keep it a bit cleaner
              .map((t) => t.replace(/_/g, " ")),
          );

          // Heuristics: if "cafe" or "bakery" etc, call it Tier C
          const tiers: string[] = ["C"];

          // Optional segments guess
          const segments: string[] = [];
          if (tags.includes("food")) segments.push("food");
          if (tags.includes("cafe") || tags.includes("store")) segments.push("retail");

          return {
            host,
            name,
            tiers,
            tags,
            cityTags: cityTag ? [cityTag] : [],
            segments,
          };
        })
        .filter(Boolean) as Array<{
        host: string;
        name: string;
        tiers: string[];
        tags: string[];
        cityTags: string[];
        segments: string[];
      }>;

      return itemsMapped.slice(0, outCap);
    });

    return res.status(200).json({ ok: true, items });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message || String(err);
    // Soft-fail (200) to keep UI happy; surface detail for debugging
    return res.status(200).json({ ok: false, items: [], error: "places-failed", detail: msg });
  }
});

export default r;