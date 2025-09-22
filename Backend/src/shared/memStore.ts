// src/shared/memStore.ts

export type Temp = 'cold' | 'warm' | 'hot';

export interface StoredLead {
  id: string;
  host: string;
  title?: string;
  platform?: string;
  created?: string; // ISO timestamp
  temp?: Temp;
  // keep anything else flexible so other code doesn't type-error
  [key: string]: any;
}

/**
 * Very small in-memory store grouped by host.
 * This is enough for the free-panel demo and to make the API compile+run.
 */
const byHost = new Map<string, StoredLead[]>();

export function getByHost(host: string): StoredLead[] {
  return byHost.get(host) ?? [];
}

export function saveByHost(host: string, leads: StoredLead[]): void {
  byHost.set(host, leads.slice());
}

export function ensureLeadForHost(host: string, lead: StoredLead): StoredLead {
  const arr = getByHost(host);
  const idx = arr.findIndex(l => l.id === lead.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...lead };
  else arr.push(lead);
  byHost.set(host, arr);
  return lead;
}

/** Find first lead for a host that matches a predicate. */
export function findByHost(
  host: string,
  predicate: (l: StoredLead) => boolean
): StoredLead | undefined {
  return getByHost(host).find(predicate);
}

/** Change a lead’s temperature. */
export function replaceHotWarm(host: string, id: string, next: Temp): void {
  const updated = getByHost(host).map(l => (l.id === id ? { ...l, temp: next } : l));
  byHost.set(host, updated);
}

/** If a lead has no temp, set it to warm. Innocent no-op otherwise. */
export function resetHotWarm(host: string): void {
  const updated = getByHost(host).map(l => (l.temp ? l : { ...l, temp: 'warm' as Temp }));
  byHost.set(host, updated);
}

/** Buckets are placeholders the panel asks for (watchers/competitors). */
export function buckets(host: string): {
  watchers: Set<string>;
  competitors: Set<string>;
} {
  // Provide empty sets so metrics can safely compute .size, etc.
  return { watchers: new Set<string>(), competitors: new Set<string>() };
}