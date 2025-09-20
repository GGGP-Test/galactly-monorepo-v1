import { promises as fs } from "fs";
import path from "path";

const CACHE_PATH = process.env.LEADS_CACHE_PATH || "/var/tmp/leads-cache.json";

/** Load previously saved leads (best-effort). */
export async function loadLeadsFromDisk(): Promise<unknown[] | null> {
  try {
    const buf = await fs.readFile(CACHE_PATH);
    const json = JSON.parse(String(buf));
    if (Array.isArray(json)) return json;
    return null;
  } catch {
    return null;
  }
}

/** Save current leads list (best-effort, atomic-ish). */
export async function saveLeadsToDisk(leads: unknown[]): Promise<void> {
  try {
    const dir = path.dirname(CACHE_PATH);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.leads-cache.${Date.now()}.tmp.json`);
    await fs.writeFile(tmp, JSON.stringify(leads ?? [], null, 0));
    await fs.rename(tmp, CACHE_PATH);
  } catch {
    // ignore disk errors; this is a convenience
  }
}