/**
 * Shared helpers for provider modules.
 */

import type { BuyerCandidate } from "./types";

export const nowISO = (): string => new Date().toISOString();

/** Normalize input like "https://www.Example.com/path" -> "example.com" */
export function normalizeHost(input: string): string {
  try {
    const url = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return url.host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return input
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

/**
 * Dedup by (host,title), safe if title is missing.
 * Also re-normalizes host for consistency.
 */
export function uniqueByHostAndTitle(arr: BuyerCandidate[]): BuyerCandidate[] {
  const seen = new Set<string>();
  const out: BuyerCandidate[] = [];

  for (const c of arr) {
    const host = normalizeHost(c.host);
    const title = (c.title ?? "").toLowerCase();
    const key = `${host}::${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, host });
  }
  return out;
}