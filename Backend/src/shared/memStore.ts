// src/shared/memStore.ts

// Buckets + helpers shared by routes

export type Temp = 'hot' | 'warm';

export type StoredLead = {
  id: number;
  host: string;
  platform?: string;
  title: string;
  created: string;
  temperature: Temp;
  whyText?: string;
  why?: any;
};

let nextId = 1;

// Public buckets used by routes/leads.ts and routes/metrics.ts
export const buckets: { hot: StoredLead[]; warm: StoredLead[] } = {
  hot: [],
  warm: [],
};

export function resetHotWarm(): void {
  buckets.hot.length = 0;
  buckets.warm.length = 0;
  nextId = 1;
}

// Replace both buckets in one shot (used by leads flow)
export function replaceHotWarm(
  hot: StoredLead[] = [],
  warm: StoredLead[] = []
): void {
  resetHotWarm();
  for (const r of hot) {
    buckets.hot.push({
      id: nextId++,
      created: r.created ?? new Date().toISOString(),
      temperature: 'hot',
      whyText: r.whyText ?? '',
      ...r,
    });
  }
  for (const r of warm) {
    buckets.warm.push({
      id: nextId++,
      created: r.created ?? new Date().toISOString(),
      temperature: 'warm',
      whyText: r.whyText ?? '',
      ...r,
    });
  }
}

// Minimal “upsert by host” used by the panel’s Lock & keep action
export function saveByHost(
  temp: Temp,
  input: { host: string; title?: string; platform?: string; whyText?: string; why?: any }
): StoredLead {
  const list = temp === 'hot' ? buckets.hot : buckets.warm;
  let row = list.find((r) => r.host === input.host);
  if (row) {
    row.title = input.title ?? row.title;
    row.platform = input.platform ?? row.platform;
    row.whyText = input.whyText ?? row.whyText;
    row.why = input.why ?? row.why;
    return row;
  }
  const created = new Date().toISOString();
  const item: StoredLead = {
    id: nextId++,
    host: input.host,
    platform: input.platform ?? 'news',
    title: input.title ?? '',
    created,
    temperature: temp,
    whyText: input.whyText ?? '',
    why: input.why,
  };
  list.push(item);
  return item;
}