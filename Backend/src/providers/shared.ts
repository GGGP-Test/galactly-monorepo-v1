import type { BuyerCandidate } from "./types";

export const nowISO = () => new Date().toISOString();

export function normalizeHost(input: string): string {
  try {
    const u = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    return u.host.replace(/^www\./, "").toLowerCase();
  } catch {
    return input.replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
  }
}

/* De-dupe by host+title; tolerate missing title (strict-null fix). */
export function uniqueByHostAndTitle(arr: BuyerCandidate[]): BuyerCandidate[] {
  const seen = new Set<string>();
  const out: BuyerCandidate[] = [];
  for (const c of arr) {
    const key = `${normalizeHost(c.host)}::${c.title ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...c, host: normalizeHost(c.host) });
    }
  }
  return out;
}