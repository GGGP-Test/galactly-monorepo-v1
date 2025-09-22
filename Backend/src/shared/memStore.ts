// src/shared/memStore.ts

// --- Types ---
export type Temp = "cold" | "warm" | "hot";

export interface StoredLead {
  host: string;
  id: string; // stable id (we'll use host)
  title?: string;
  platform?: string;
  created: string; // ISO
  temperature: Temp;
  why?: string;
  saved?: boolean;
}

// --- State ---
const leadsByHost = new Map<string, StoredLead>();

type WatchInfo = { watchers: Set<string>; competitors: Set<string> };
const watchMap = new Map<string, WatchInfo>();

// --- Helpers ---
function nowISO() {
  return new Date().toISOString();
}

function getWatchInfo(host: string): WatchInfo {
  let wi = watchMap.get(host);
  if (!wi) {
    wi = { watchers: new Set<string>(), competitors: new Set<string>() };
    watchMap.set(host, wi);
  }
  return wi;
}

// --- Lead primitives ---
export function getByHost(host: string): StoredLead | undefined {
  return leadsByHost.get(host);
}
export const findByHost = getByHost; // alias some code expects

export function ensureLeadForHost(host: string): StoredLead {
  const existing = leadsByHost.get(host);
  if (existing) return existing;

  const fresh: StoredLead = {
    host,
    id: host,
    created: nowISO(),
    temperature: "cold",
  };
  leadsByHost.set(host, fresh);
  return fresh;
}

export function saveByHost(host: string, patch: Partial<StoredLead> = {}): StoredLead {
  const lead = ensureLeadForHost(host);
  const updated: StoredLead = {
    ...lead,
    ...patch,
    host, // never allow host/id to drift
    id: host,
  };
  leadsByHost.set(host, updated);
  return updated;
}

export function replaceHotWarm(host: string, to: Temp): StoredLead {
  const lead = ensureLeadForHost(host);
  if (to !== "hot" && to !== "warm" && to !== "cold") to = "warm";
  lead.temperature = to;
  // mark as saved/touched so it shows up to UIs that depend on it
  lead.saved = true;
  leadsByHost.set(host, lead);
  return lead;
}

export function resetHotWarm(host: string): StoredLead {
  const lead = ensureLeadForHost(host);
  lead.temperature = "cold";
  leadsByHost.set(host, lead);
  return lead;
}

// --- Buckets / counters ---
export function buckets(): { hot: StoredLead[]; warm: StoredLead[]; cold: StoredLead[] } {
  const out = { hot: [] as StoredLead[], warm: [] as StoredLead[], cold: [] as StoredLead[] };
  for (const lead of leadsByHost.values()) {
    out[lead.temperature].push(lead);
  }
  return out;
}

// --- Watchers / competitors ---
// Return arrays so callers can safely use `.length`
export function watchers(host: string): { watchers: string[]; competitors: string[] } {
  const wi = getWatchInfo(host);
  return {
    watchers: Array.from(wi.watchers),
    competitors: Array.from(wi.competitors),
  };
}

// Optional mutators (not currently required by routes, but handy)
export function addWatcher(host: string, id: string) {
  getWatchInfo(host).watchers.add(id);
}
export function addCompetitor(host: string, id: string) {
  getWatchInfo(host).competitors.add(id);
}