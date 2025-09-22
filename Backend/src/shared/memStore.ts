// src/shared/memStore.ts
export type Temp = 'hot' | 'warm';
export type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature?: Temp;
  whyText?: string;
  why?: any;
};

let nextId = 1;

// Buckets visible to the Free Panel
export const buckets = {
  hot: [] as StoredLead[],
  warm: [] as StoredLead[],
  saved: [] as StoredLead[],
};

// Reset only the hot/warm buckets (we keep saved = what the user locked)
export function resetHotWarm() {
  buckets.hot = [];
  buckets.warm = [];
}

// Replace hot/warm with fresh results
export function replaceHotWarm(items: StoredLead[]) {
  buckets.hot = [];
  buckets.warm = [];
  for (const it of items) {
    if (it.temperature === 'hot') buckets.hot.push(it);
    else buckets.warm.push(it);
  }
}

// Save a lead by host (used by /metrics/claim). If we don't find a
// matching candidate in hot/warm, we still create a minimal saved row.
export function saveByHost(host: string, title?: string) {
  const src =
    [...buckets.hot, ...buckets.warm].find((l) => l.host === host) || null;

  const item: StoredLead = src
    ? {
        id: nextId++,
        host: src.host,
        platform: src.platform,
        title: src.title || title || host,
        created: new Date().toISOString(),
        temperature: src.temperature,
        whyText: src.whyText,
        why: src.why,
      }
    : {
        id: nextId++,
        host,
        platform: 'unknown',
        title: title || host,
        created: new Date().toISOString(),
        temperature: 'warm',
        whyText: 'Locked manually',
        why: { context: { label: 'manual', detail: 'claimed via lock' } },
      };

  buckets.saved.unshift(item);
  return item;
}