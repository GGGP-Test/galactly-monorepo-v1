// src/shared/memStore.ts
//
// Minimal in-memory store used by the routes.
// Exports are shaped to match how your routes already use them,
// so you shouldn’t need to touch metrics.ts or leads.ts.

export type Temp = "cold" | "warm" | "hot";

export interface StoredLead {
  id: string;
  host: string;
  title?: string;
  platform?: string;          // routes sometimes patch with { platform }
  created: string;            // ISO date string
  temperature?: Temp;         // optional; defaults to "cold" in helpers
  why?: unknown;              // any extra metadata your UI shows
}

// --- internal state ---------------------------------------------------------

const byHost = new Map<string, StoredLead>();

// we keep watcher/competitor membership as Sets internally
const _watchers = new Map<string, Set<string>>();
const _competitors = new Map<string, Set<string>>();

// --- helpers ---------------------------------------------------------------

function asTemp(t?: string | Temp): Temp {
  if (t === "hot" || t === "warm" || t === "cold") return t;
  return "cold";
}

export function ensureLeadForHost(host: string): StoredLead {
  let lead = byHost.get(host);
  if (!lead) {
    lead = {
      id: host,
      host,
      created: new Date().toISOString(),
      temperature: "cold",
    };
    byHost.set(host, lead);
  }
  return lead;
}

export function getByHost(host: string): StoredLead | undefined {
  return byHost.get(host);
}

// alias some projects use
export const findByHost = getByHost;

/**
 * Patch / upsert a lead by host. Accepts any subset of StoredLead fields.
 */
export function saveByHost(host: string, patch: Partial<StoredLead>): StoredLead {
  const lead = ensureLeadForHost(host);
  if (patch.title !== undefined) lead.title = patch.title;
  if (patch.platform !== undefined) lead.platform = patch.platform;
  if (patch.created !== undefined) lead.created = patch.created;
  if (patch.why !== undefined) lead.why = patch.why;
  if (patch.temperature !== undefined) lead.temperature = asTemp(patch.temperature);
  // never change id/host via patch
  return lead;
}

/**
 * Set temperature for a host (routes sometimes call this with a string).
 */
export function replaceHotWarm(host: string, next: Temp | string): StoredLead {
  const lead = ensureLeadForHost(host);
  lead.temperature = asTemp(next);
  return lead;
}

/**
 * Reset temperature back to "cold".
 */
export function resetHotWarm(host: string): StoredLead {
  const lead = ensureLeadForHost(host);
  lead.temperature = "cold";
  return lead;
}

/**
 * Buckets of leads by temperature, useful for metrics.
 */
export function buckets(): Record<Temp, StoredLead[]> {
  const out: Record<Temp, StoredLead[]> = { hot: [], warm: [], cold: [] };
  for (const lead of byHost.values()) {
    const t = asTemp(lead.temperature);
    out[t].push(lead);
  }
  return out;
}

// --- watchers / competitors -------------------------------------------------
// NOTE: metrics.ts uses `.length`, so we return arrays (not Sets).

export function addWatcher(host: string, who: string): void {
  const set = _watchers.get(host) ?? new Set<string>();
  set.add(who);
  _watchers.set(host, set);
}

export function addCompetitor(host: string, who: string): void {
  const set = _competitors.get(host) ?? new Set<string>();
  set.add(who);
  _competitors.set(host, set);
}

/**
 * Return arrays so code can safely call `.length`.
 */
export function watchers(host: string): { watchers: string[]; competitors: string[] } {
  return {
    watchers: Array.from(_watchers.get(host) ?? new Set<string>()),
    competitors: Array.from(_competitors.get(host) ?? new Set<string>()),
  };
}

// convenience getters some routes reference
export function getByHostOrCreate(host: string): StoredLead {
  return ensureLeadForHost(host);
}