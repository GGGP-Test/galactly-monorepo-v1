// src/shared/memStore.ts

// --- Types ----------------------------------------------------
export type Temp = "cold" | "warm" | "hot";

export interface StoredLead {
  host: string;
  id: string;                // stable id (we use host)
  title?: string;
  platform?: string;
  created: string;           // ISO
  temperature: Temp;
  why?: string;
  saved?: boolean;           // set when explicitly locked or persisted
  touchedAt: number;         // millis since epoch (last update/lock)
}

// Summary snapshot for lightweight UI counters
export interface Summary {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  saved: number;
  updatedAt: string;         // ISO when this summary was computed
}

// --- Config (ageing policy) ----------------------------------
// Simple, predictable ageing:
// - HOT: never purged automatically; decays to WARM after HOT_DECAY if not touched
// - WARM: decays to COLD after WARM_DECAY if not touched
// - COLD: purged after COLD_TTL unless saved
//
// Locking (moving to WARM/HOT) "bumps" touchedAt which postpones decay/purge.
const NOW = () => Date.now();

const HOT_DECAY_MS  = 7 * 24 * 60 * 60 * 1000;   // 7 days without touch -> warm
const WARM_DECAY_MS = 24 * 60 * 60 * 1000;       // 24h without touch -> cold
const COLD_TTL_MS   = 2 * 60 * 60 * 1000;        // 2h without touch -> purge

// Saved items are stickier: never purged; they still may decay hot->warm->cold visually.
const DECAY_ENABLED_FOR_SAVED = true;

// --- State ----------------------------------------------------
const leadsByHost = new Map<string, StoredLead>();

type WatchInfo = { watchers: Set<string>; competitors: Set<string> };
const watchMap = new Map<string, WatchInfo>();

// --- Helpers --------------------------------------------------
function nowISO() { return new Date().toISOString(); }

function getWatchInfo(host: string): WatchInfo {
  let wi = watchMap.get(host);
  if (!wi) {
    wi = { watchers: new Set<string>(), competitors: new Set<string>() };
    watchMap.set(host, wi);
  }
  return wi;
}

function clampTemp(t: any): Temp {
  return t === "hot" || t === "warm" ? t : "cold";
}

// Age/decay a single lead in-place based on touchedAt and saved flag.
// Returns false if the lead should be purged.
function ageOne(lead: StoredLead, now = NOW()): boolean {
  const idle = now - lead.touchedAt;

  if (lead.saved !== true) {
    // Unsaved: purge cold after TTL.
    if (lead.temperature === "cold" && idle > COLD_TTL_MS) return false;
  }

  // Visual decay (optionally also for saved)
  if (lead.temperature === "hot" && idle > HOT_DECAY_MS) {
    if (DECAY_ENABLED_FOR_SAVED || !lead.saved) lead.temperature = "warm";
  }
  if (lead.temperature === "warm" && idle > WARM_DECAY_MS) {
    if (DECAY_ENABLED_FOR_SAVED || !lead.saved) lead.temperature = "cold";
  }
  return true;
}

// Sweep periodically
function purgeExpired(now = NOW()) {
  for (const [host, lead] of leadsByHost.entries()) {
    const keep = ageOne(lead, now);
    if (!keep) leadsByHost.delete(host);
  }
}

// Run an interval to keep memory tidy; cheap O(n).
setInterval(() => purgeExpired(), 90 * 1000).unref?.();

// --- Lead primitives -----------------------------------------
export function getByHost(host: string): StoredLead | undefined {
  const l = leadsByHost.get(host);
  if (!l) return undefined;
  // Ensure decay rules applied lazily on read as well.
  ageOne(l);
  return l;
}
export const findByHost = getByHost; // alias some code expects

export function ensureLeadForHost(host: string): StoredLead {
  const existing = leadsByHost.get(host);
  if (existing) {
    ageOne(existing);
    return existing;
  }
  const fresh: StoredLead = {
    host,
    id: host,
    created: nowISO(),
    temperature: "cold",
    touchedAt: NOW(),
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
    touchedAt: NOW(),
    temperature: clampTemp((patch as any)?.temperature ?? lead.temperature),
  };
  leadsByHost.set(host, updated);
  return updated;
}

// When a user "locks" a candidate, we bump freshness and set temperature
export function replaceHotWarm(host: string, to: Temp): StoredLead {
  const lead = ensureLeadForHost(host);
  lead.temperature = clampTemp(to);
  lead.saved = true;             // locked -> saved
  lead.touchedAt = NOW();        // bump freshness
  leadsByHost.set(host, lead);
  return lead;
}

export function resetHotWarm(host: string): StoredLead {
  const lead = ensureLeadForHost(host);
  lead.temperature = "cold";
  lead.touchedAt = NOW();
  leadsByHost.set(host, lead);
  return lead;
}

// --- Buckets / queries ---------------------------------------
export function buckets(): { hot: StoredLead[]; warm: StoredLead[]; cold: StoredLead[] } {
  purgeExpired(); // keep answers fresh
  const out = { hot: [] as StoredLead[], warm: [] as StoredLead[], cold: [] as StoredLead[] };
  for (const lead of leadsByHost.values()) {
    out[lead.temperature].push(lead);
  }
  return out;
}

export function listHot(): StoredLead[]  { return buckets().hot; }
export function listWarm(): StoredLead[] { return buckets().warm; }
export function listCold(): StoredLead[] { return buckets().cold; }
export function listAll(): StoredLead[]  {
  purgeExpired();
  return Array.from(leadsByHost.values());
}

// Lightweight numbers for the panel badge/counters
export function summary(): Summary {
  purgeExpired();
  let hot = 0, warm = 0, cold = 0, saved = 0;
  for (const l of leadsByHost.values()) {
    if (l.saved) saved++;
    if (l.temperature === "hot") hot++;
    else if (l.temperature === "warm") warm++;
    else cold++;
  }
  return {
    total: hot + warm + cold,
    hot, warm, cold, saved,
    updatedAt: nowISO(),
  };
}

// --- Watchers / competitors ----------------------------------
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

// --- CSV helper (tiny & safe) --------------------------------
export function toCSV(items: StoredLead[]): string {
  const cols = ["host","platform","title","created","temperature","why"];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g,'""')}"`;
  const head = cols.join(',');
  const rows = items.map(it => cols.map(c => {
    const k = c as keyof StoredLead;
    return esc(k === "temperature" ? it.temperature : (it[k] as any));
  }).join(','));
  return [head, ...rows].join('\r\n');
}