// src/routes/places.ts
//
// Google Places search with caching + cost guardrails.
// GET /api/places/search?q=coffee shop&city=los angeles&limit=5
//
// - Uses in-process TTL cache (shared/guards.withCache)
// - Daily + burst caps (shared/guards.daily/rate)
// - Soft-fail on quota/rate errors (HTTP 200 with ok:false)
// - No hard TS dependency on shared/env AppConfig names
//   (reads process.env directly to avoid type drift)

import { Router, Request, Response } from "express";
import { capResults } from "../shared/env";
import { withCache, daily, rate } from "../shared/guards";

const r = Router();

// ---- env (read directly to avoid type coupling) ----
const PLACES_KEY = String(process.env.GOOGLE_PLACES_API_KEY || "");
const CACHE_TTL_S =
  Number(process.env.CACHE_TTL_S || process.env.CACHE_TTL_SEC || 300) || 300;
const PLACES_LIMIT_DEFAULT = Number(process.env.PLACES_LIMIT_DEFAULT || 10) || 10;
const FREE_CLICKS_PER_DAY = Number(process.env.FREE_CLICKS_PER_DAY || 25) || 25;

// Explicit fetch type so we don't need DOM lib types
const F: (input: any, init?: any) => Promise<any> = (globalThis as any).fetch;

// ---------- small helpers ----------
function q(req: Request, key: string): string | undefined {
  const v = (req.query as Record<string, unknown> | undefined)?.[key];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function clientKey(req: Request): string {
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
    new URLSearchParams({ query, key }).toString();

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
      fields: "website,name,types",
      key,
    }).toString();

  const res = await F(url);
  const data = (await res.json()) as GDetailsResponse;
  if (data.status && data.status !== "OK") return undefined; // skip NOT_FOUND, etc.
  return data.result;
}

// ---------- route ----------
r.get("/search", async (req: Request, res: Response) => {
  try {
    if (!PLACES_KEY) {
      return res
        .status(200)
        .json({ ok: false, items: [], error: "places-disabled", detail: "missing api key" });
    }

    const rawQ = q(req, "q") || "";
    const city = q(req, "city") || "";
    const wantLimit = Number(q(req, "limit"));
    const baseLimit =
      Number.isFinite(wantLimit) && wantLimit > 0 ? Math.floor(wantLimit) : PLACES_LIMIT_DEFAULT;

    // cap like "free plan" for now; we can switch to per-key later
    const outCap = capResults(false /* isPro */, baseLimit);

    // ---- guardrails: daily + simple burst gate
    const who = clientKey(req);
    const day = daily.allow(`places:${who}`, Math.max(1, FREE_CLICKS_PER_DAY));
    if (!day.ok) {
      return res.status(200).json({ ok: false, items: [], error: "daily-quota-exceeded" });
    }

    const burst = rate.allow(`places:${who}`, 5 /* per window */, 10_000 /* ms */);
    if (!burst.ok) {
      return res
        .status(200)
        .json({ ok: false, items: [], error: "rate-limited", retryInMs: burst.resetInMs });
    }

    const query = [rawQ, city].filter(Boolean).join(" ").trim();
    if (!query) return res.status(200).json({ ok: true, items: [] });

    const cacheKey = `places:${query}:cap${outCap}`;
    const ttlMs = Math.max(5, CACHE_TTL_S) * 1000;

    const items = await withCache(cacheKey, ttlMs, async () => {
      // 1) text search
      const results = await googleTextSearch(query, PLACES_KEY);

      // 2) attempt details for the top N
      const take = results.slice(0, outCap);
      const details = await Promise.all(take.map((r) => googleDetails(r.place_id, PLACES_KEY)));

      // 3) map into our FreePanel-ish shape
      const cityTag = city.toLowerCase();
      const mapped = details
        .map((d) => {
          if (!d) return undefined;
          const host = toHost(d.website);
          if (!host) return undefined;
          const name = asStr(d.name);
          const types = Array.isArray(d.types) ? d.types : [];
          const tags = uniq(
            types
              .map((t) => t.toLowerCase())
              .filter((t) => t && t !== "point_of_interest")
              .map((t) => t.replace(/_/g, " ")),
          );
          const tiers: string[] = ["C"];
          const segments: string[] = [];
          if (tags.includes("food")) segments.push("food");
          if (tags.includes("cafe") || tags.includes("store")) segments.push("retail");

          return { host, name, tiers, tags, cityTags: cityTag ? [cityTag] : [], segments };
        })
        .filter(Boolean) as Array<{
        host: string;
        name: string;
        tiers: string[];
        tags: string[];
        cityTags: string[];
        segments: string[];
      }>;

      return mapped.slice(0, outCap);
    });

    return res.status(200).json({ ok: true, items });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message || String(err);
    return res.status(200).json({ ok: false, items: [], error: "places-failed", detail: msg });
  }
});

export default r;