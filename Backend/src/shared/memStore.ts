// src/shared/memStore.ts
// A tiny in-memory store shared by routes (leads + metrics).

export type Temp = 'hot' | 'warm';

export interface StoredLead {
  id: number;
  host: string;           // e.g. "news.google.com"
  platform?: string;
  title: string;
  created: string;        // ISO string
  temperature: Temp;
  whyText?: string;
  why?: any;
}

// ---- leads buckets (what the panel lists) ----
export const buckets: { hot: StoredLead[]; warm: StoredLead[] } = {
  hot: [],
  warm: [],
};

let nextId = 1;
const allocId = () => nextId++;

/** wipe both buckets (used on new searches) */
export function resetHotWarm() {
  buckets.hot = [];
  buckets.warm = [];
  nextId = 1;
}

/** replace both buckets at once */
export function replaceHotWarm(hot: StoredLead[], warm: StoredLead[]) {
  buckets.hot = hot;
  buckets.warm = warm;
}

/** find a lead by host in either bucket */
export function findByHost(host: string): { bucket: 'hot' | 'warm'; index: number } | null {
  const iHot = buckets.hot.findIndex(x => x.host === host);
  if (iHot >= 0) return { bucket: 'hot', index: iHot };
  const iWarm = buckets.warm.findIndex(x => x.host === host);
  if (iWarm >= 0) return { bucket: 'warm', index: iWarm };
  return null;
}

/** ensure a lead exists for this host (creates a minimal warm lead if missing) */
export function ensureLeadForHost(host: string, patch: Partial<StoredLead> = {}): StoredLead {
  const where = findByHost(host);
  if (where) {
    const row = buckets[where.bucket][where.index];
    Object.assign(row, patch);
    return row;
  }
  const row: StoredLead = {
    id: allocId(),
    host,
    platform: 'news',
    title: patch.title || (patch.whyText ?? '') || host,
    created: new Date().toISOString(),
    temperature: (patch.temperature as Temp) || 'warm',
    whyText: patch.whyText,
    why: patch.why,
  };
  buckets[row.temperature].push(row);
  return row;
}

// ---- very small key->value store used by /metrics routes ----
const metricsByHost = new Map<string, any>();

/** save (or merge) an arbitrary record by host. Used by /metrics/claim */
export function saveByHost(host: string, value: any) {
  const prev = metricsByHost.get(host) || {};
  const merged = typeof value === 'object' && value ? { ...prev, ...value } : value;
  metricsByHost.set(host, merged);
  return merged;
}

export function getByHost(host: string) {
  return metricsByHost.get(host) ?? null;
}