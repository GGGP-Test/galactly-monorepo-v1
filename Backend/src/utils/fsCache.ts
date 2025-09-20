// Tiny JSON file cache for last-run leads.
// Path can be overridden with ARTEMIS_CACHE env var.
import fs from "fs/promises";
import path from "path";
import { UICandidate, FindBuyersInput } from "../providers/types";

const CACHE_FILE = process.env.ARTEMIS_CACHE || "/var/tmp/artemis-cache.json";

type CacheRow = {
  hot: UICandidate[];
  warm: UICandidate[];
  meta?: Record<string, unknown>;
  at: number; // epoch ms
};

type CacheShape = Record<string, CacheRow> & {
  __last__?: { key: string; at: number };
};

async function readCache(): Promise<CacheShape> {
  try {
    const txt = await fs.readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(txt) as unknown;
    return (parsed && typeof parsed === "object" ? parsed : {}) as CacheShape;
  } catch {
    return {};
  }
}

async function writeCache(obj: CacheShape): Promise<void> {
  const dir = path.dirname(CACHE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(obj, null, 2), "utf8");
}

/** Builds a stable key for a run (domain/region/radius + persona). */
export function buildCacheKey(input: FindBuyersInput, htmlHash?: string): string {
  const titles = Array.isArray(input.persona?.titles)
    ? input.persona!.titles.join("|")
    : String(input.persona?.titles || "");
  const base = [
    input.supplier,
    input.region,
    String(input.radiusMi),
    String(input.persona?.offer || ""),
    String(input.persona?.solves || ""),
    titles,
  ].join("|");
  return htmlHash ? `${base}|${htmlHash}` : base;
}

/** Reads from disk; returns null if nothing for this key. */
export async function loadLeadsFromDisk(
  key: string
): Promise<{ hot: UICandidate[]; warm: UICandidate[]; meta?: Record<string, unknown> } | null> {
  const cache = await readCache();
  const row = cache[key];
  if (!row) return null;
  return { hot: row.hot ?? [], warm: row.warm ?? [], meta: row.meta };
}

/** Persists to disk, and remembers the most-recent key under __last__. */
export async function saveLeadsToDisk(
  key: string,
  hot: UICandidate[],
  warm: UICandidate[],
  meta?: Record<string, unknown>
): Promise<void> {
  const cache = await readCache();
  cache[key] = { hot, warm, meta, at: Date.now() };
  cache.__last__ = { key, at: Date.now() };
  await writeCache(cache);
}