import type { BuyerCandidate } from './types';

export const nowISO = () => new Date().toISOString();

/** Normalize to host only (strip scheme/path/www) */
export function normalizeHost(input: string): string {
  try {
    const u = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
    return u.host.replace(/^www\./, '').toLowerCase();
  } catch {
    return input.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

export function uniqueByHostAndTitle(arr: BuyerCandidate[]): BuyerCandidate[] {
  const seen = new Set<string>();
  const out: BuyerCandidate[] = [];
  for (const c of arr) {
    const k = `${normalizeHost(c.host)}::${c.title.toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ ...c, host: normalizeHost(c.host) });
    }
  }
  return out;
}