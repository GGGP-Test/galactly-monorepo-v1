// src/utils/fsCache.ts
import { promises as fs } from "fs";
import * as path from "path";

const DEFAULT_PATH = process.env.CACHE_PATH || "/var/tmp/artemis-cache.json";

type CacheShape = Record<string, unknown>;

async function readCache(file = DEFAULT_PATH): Promise<CacheShape> {
  try {
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data) as CacheShape;
  } catch {
    // File missing or invalid → start fresh
    return {};
  }
}

async function writeCache(obj: CacheShape, file = DEFAULT_PATH): Promise<void> {
  const dir = path.dirname(file);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(obj), "utf8");
  await fs.rename(tmp, file);
}

/** Build a deterministic cache key from a small record of inputs. */
export function makeKey(parts: Record<string, unknown>): string {
  // stable-ish stringify
  const entries = Object.entries(parts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries
    .map(([k, v]) => `${k}:${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("|");
}

/** Get from cache file. Returns undefined on miss. */
export async function cacheGet<T = unknown>(key: string, file = DEFAULT_PATH): Promise<T | undefined> {
  const obj = await readCache(file);
  return obj[key] as T | undefined;
}

/** Put into cache file. */
export async function cacheSet<T = unknown>(key: string, value: T, file = DEFAULT_PATH): Promise<void> {
  const obj = await readCache(file);
  obj[key] = value as unknown;
  await writeCache(obj, file);
}

/** Convenience: store a leads payload under a namespaced key. */
export async function saveLeadsToDisk(key: string, payload: unknown, file = DEFAULT_PATH): Promise<void> {
  await cacheSet(`leads:${key}`, payload, file);
}

/** Convenience: load a leads payload by namespaced key. */
export async function loadLeadsFromDisk<T = unknown>(key: string, file = DEFAULT_PATH): Promise<T | undefined> {
  return cacheGet<T>(`leads:${key}`, file);
}