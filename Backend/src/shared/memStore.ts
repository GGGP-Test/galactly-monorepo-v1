// src/shared/memStore.ts

// ---- Types ----
export type Temp = 'hot' | 'warm' | 'cold';

export interface StoredLead {
  id: string;
  host: string;
  created: string;        // ISO timestamp
  title?: string;
  temp?: Temp;
  why?: any;
  detail?: any;
}

// ---- In-memory data ----
const leadsByHost = new Map<string, StoredLead>();

// We track which hosts are hot/warm/cold.  Keys are hosts.
export const buckets: Record<Temp, Set<string>> = {
  hot: new Set<string>(),
  warm: new Set<string>(),
  cold: new Set<string>(),
};

// ---- Helpers ----
function nowISO(): string {
  return new Date().toISOString();
}

function makeId(host: string): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${host}`;
}

// ---- API ----
export function getByHost(host: string): StoredLead | undefined {
  return leadsByHost.get(host);
}

// alias (some code calls findByHost)
export const findByHost = getByHost;

export function ensureLeadForHost(host: string): StoredLead {
  const existing = leadsByHost.get(host);
  if (existing) return existing;

  const lead: StoredLead = {
    id: makeId(host),
    host,
    created: nowISO(),
    temp: 'warm',
  };

  leadsByHost.set(host, lead);
  buckets.warm.add(host);
  return lead;
}

// merge/patch and keep bucket membership correct
export function saveByHost(host: string, patch: Partial<StoredLead>): StoredLead {
  const lead = ensureLeadForHost(host);

  const before = lead.temp ?? 'warm';
  Object.assign(lead, patch);

  const after = lead.temp ?? before;
  if (after !== before) {
    buckets[before].delete(host);
    buckets[after].add(host);
  }

  leadsByHost.set(host, lead);
  return lead;
}

// accept either the Temp union or any string (for loose callers)
export function replaceHotWarm(host: string, next: Temp | string): void {
  const lead = ensureLeadForHost(host);
  const target: Temp = next === 'hot' || next === 'cold' ? next : 'warm';

  const before = lead.temp ?? 'warm';
  if (before !== target) {
    buckets[before].delete(host);
    buckets[target].add(host);
  }
  lead.temp = target;
}

// clear hot/warm buckets (used by metrics endpoints)
export function resetHotWarm(): void {
  buckets.hot.clear();
  buckets.warm.clear();
}

// optional default export (so both default and named imports work)
const api = {
  buckets,
  getByHost,
  findByHost,
  ensureLeadForHost,
  saveByHost,
  replaceHotWarm,
  resetHotWarm,
};
export default api;