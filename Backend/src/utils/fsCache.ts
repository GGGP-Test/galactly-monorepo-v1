// src/utils/fsCache.ts
import { promises as fs } from "fs";
import path from "path";

const CACHE_FILE =
  process.env.ARTEMIS_CACHE_FILE || "/var/tmp/artemis-cache.json";

// shape we write to disk
type CacheRecord<T = unknown> = {
  value: T;
  expiresAt: number; // epoch ms
};

type CacheMap = Record<string, CacheRecord>;

async function readJsonSafe(file: string): Promise<CacheMap> {
  try {
    const buf = await fs.readFile(file);
    const data = JSON.parse(buf.toString()) as CacheMap;
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

async function writeJsonSafe(file: string, data: CacheMap): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), "utf8");
}

/** Stable key from an object (domain/region/persona/etc.) */
export function makeKey(parts: Record<string, unknown>): string {
  const entries = Object.entries(parts).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return entries
    .map(([k, v]) => `${k}=${String(v ?? "")}`)
    .join("|");
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  const db = await readJsonSafe(CACHE_FILE);
  const rec = db[key];
  if (!rec) return null;
  if (Date.now() > rec.expiresAt) {
    // expired → drop it lazily
    delete db[key];
    await writeJsonSafe(CACHE_FILE, db);
    return null;
  }
  return rec.value as T;
}

export async function cacheSet<T = unknown>(
  key: string,
  value: T,
  ttlMs = 1000 * 60 * 60 * 24 * 30, // 30 days
): Promise<void> {
  const db = await readJsonSafe(CACHE_FILE);
  db[key] = { value, expiresAt: Date.now() + ttlMs };
  await writeJsonSafe(CACHE_FILE, db);
}