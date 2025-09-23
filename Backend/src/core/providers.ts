// src/core/providers.ts
//
// Minimal provider framework for buyer discovery.
// - Zero deps
// - Safe to drop in without changing routes yet
// - Exposes a default "shim" provider so behavior is stable today
//
// Next step (separate file): import { findBuyerLead } in routes/buyers.ts
// and replace the local computeLead(...) call with it.

export type Temp = 'hot' | 'warm' | 'cold';

export type ProviderInput = {
  host: string;        // supplier domain (e.g., "peekpackaging.com")
  region: string;      // "US/CA", "US", etc.
  radius: string;      // "50 mi"
};

export type LeadItem = {
  host: string;
  platform?: 'web' | string;
  title?: string;
  created?: string;    // ISO
  temp?: Temp | string;
  whyText?: string;
  score?: number;      // optional ranking score for future providers
};

export type Provider = (input: ProviderInput) => Promise<LeadItem | LeadItem[] | null | undefined>;

type RegistryItem = {
  id: string;
  fn: Provider;
  weight: number; // simple ordering; higher runs earlier
};

const REGISTRY: RegistryItem[] = [];

/** Register a provider with an ID and optional weight (default 0). */
export function registerProvider(id: string, fn: Provider, weight = 0) {
  REGISTRY.push({ id, fn, weight });
  REGISTRY.sort((a, b) => b.weight - a.weight);
}

/** Return current provider IDs (for diagnostics). */
export function listProviders(): string[] {
  return REGISTRY.map(p => p.id);
}

/** Simple score fallback if a provider didn't set one. */
function baselineScore(item: LeadItem): number {
  // crude: bump 'hot' > 'warm' > 'cold', newer timestamps slightly higher
  const tempScore = item.temp === 'hot' ? 0.9 : item.temp === 'warm' ? 0.6 : 0.3;
  let recency = 0;
  if (item.created) {
    const t = Date.parse(item.created);
    if (!Number.isNaN(t)) {
      const ageH = (Date.now() - t) / 3_600_000; // hours
      recency = Math.max(0, 1 - Math.min(ageH / 168, 1)) * 0.1; // <= +0.1 within a week
    }
  }
  return (item.score ?? 0) * 0.7 + tempScore * 0.25 + recency * 0.05;
}

/** Normalize arbitrary provider outputs into a unique set by host. */
function normalizeUnique(items: (LeadItem | null | undefined)[]): LeadItem[] {
  const out: LeadItem[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it) continue;
    const host = (it.host || '').trim().toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push({
      ...it,
      host,
      platform: it.platform ?? 'web',
      created: it.created ?? new Date().toISOString(),
      temp: it.temp ?? 'warm',
      whyText: it.whyText ?? '',
      score: typeof it.score === 'number' ? it.score : undefined,
    });
  }
  return out;
}

/**
 * Run providers in priority order, return a ranked list.
 * Today we return the best single lead (to match current UI), but callers
 * can request `topK` > 1 when we expand results per click.
 */
export async function runProviders(
  input: ProviderInput,
  topK = 1
): Promise<LeadItem[]> {
  if (REGISTRY.length === 0) {
    // Ensure we always have *something* (shim registers below).
    await ensureShimRegistered();
  }

  const collected: LeadItem[] = [];

  for (const p of REGISTRY) {
    try {
      const res = await p.fn(input);
      const arr = Array.isArray(res) ? res : (res ? [res] : []);
      collected.push(...arr);
      // Fast path: if we already have enough, stop early
      if (collected.length >= topK) break;
    } catch (_e) {
      // swallow provider errors; continue to next
      // (we can add logging hook here later)
    }
  }

  const unique = normalizeUnique(collected);
  unique.sort((a, b) => baselineScore(b) - baselineScore(a));
  return unique.slice(0, Math.max(1, topK));
}

/** Convenience: return a single best lead (matches current buyers.ts shape). */
export async function findBuyerLead(host: string, region: string, radius: string): Promise<LeadItem> {
  const [best] = await runProviders({ host, region, radius }, 1);
  return best;
}

// ---------------- Default "shim" provider ----------------

let shimReady = false;

async function ensureShimRegistered() {
  if (shimReady) return;
  registerProvider('shim', async ({ host, region, radius }) => {
    return {
      host,
      platform: 'web',
      title: `Buyer lead for ${host}`,
      created: new Date().toISOString(),
      temp: 'warm',
      whyText: `Compat shim matched (${region}, ${radius})`,
      score: 0.5,
    };
  }, -1000); // lowest priority once we add real providers
  shimReady = true;
}

// Pre-register on import so callers can use runProviders immediately.
void ensureShimRegistered();

export default {
  registerProvider,
  listProviders,
  runProviders,
  findBuyerLead,
};