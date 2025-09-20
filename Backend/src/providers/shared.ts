import type { Candidate, PersonaInput } from "./types";

export const nowISO = () => new Date().toISOString();

export function normalizeHost(input: string): string {
  try {
    const u = input.includes("://") ? new URL(input) : new URL("https://" + input);
    return (u.host || input).replace(/^www\./, "").toLowerCase();
  } catch {
    return input.replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
  }
}

export function uniqueByHostAndTitle<T extends Candidate>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of arr) {
    const key = `${normalizeHost(c.host)}::${(c.title || "").toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...c, host: normalizeHost(c.host) });
    }
  }
  return out;
}

export function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function personaHash(p?: PersonaInput): string {
  if (!p) return "none";
  const titles = Array.isArray(p.titles) ? p.titles.join(",") : p.titles || "";
  const s = `${p.offer}||${p.solves}||${titles}`.toLowerCase().trim();
  return djb2Hash(s);
}