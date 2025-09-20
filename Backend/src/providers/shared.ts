import type { BuyerCandidate } from "./types";

export const nowISO = () => new Date().toISOString();

/** Normalize host/domain from a URL or host-like string. */
export function normalizeHost(input: string): string {
  if (!input) return "";
  try {
    const u = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return u.host.replace(/^www\./, "").toLowerCase();
  } catch {
    return input.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
  }
}

/** De-dupe by host+title; tolerate missing title under strict mode. */
export function uniqueByHostAndTitle(arr: BuyerCandidate[]): BuyerCandidate[] {
  const seen = new Set<string>();
  const out: BuyerCandidate[] = [];
  for (const c of arr) {
    const key = `${normalizeHost(c.host)}::${(c.title ?? "").trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...c, host: normalizeHost(c.host) });
    }
  }
  return out;
}