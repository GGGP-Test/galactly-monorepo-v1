// Backend/src/providers/shared.ts

import type { Candidate } from "./types";

export function normalizeHost(s: string): string {
  try {
    const u = s.includes("://") ? new URL(s) : new URL("https://" + s);
    return u.hostname.replace(/^www\./i, "");
  } catch {
    return (s || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}

export function dedupeByHost<T extends { host: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of list) {
    const key = (c.host || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function csvToList(csv: string): string[] {
  return (csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export function firstTitleFromCsv(csv: string, fallback = "Purchasing Manager"): string {
  const list = csvToList(csv);
  return list[0] || fallback;
}

export function regionToQuery(region: string): string {
  const r = (region || "").toLowerCase();
  if (r.includes("us") && r.includes("ca")) return "(site:.com OR site:.us OR site:.ca)";
  if (r.startsWith("us")) return "(site:.com OR site:.us)";
  if (r.startsWith("ca")) return "(site:.ca)";
  return "";
}

export function toHosts(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      if (!seen.has(host)) {
        seen.add(host);
        out.push(host);
      }
    } catch { /* ignore */ }
  }
  return out;
}