import { nowISO, normalizeHost } from './shared';
import type { BuyerCandidate, DiscoveryArgs } from './types';

/**
 * Deterministic seed output so the Free Panel never shows zero.
 * Mirrors your screenshot (12 warm-ish candidates).
 */
const SEED_HOSTS: Array<[string, string]> = [
  ['blueboxretail.com', 'Purchasing Manager'],
  ['acmefoods.com', 'Procurement Lead'],
  ['nwpallets.ca', 'Buyer'],
  ['logiship.com', 'Head of Ops'],
  ['freshgrocer.com', 'Sourcing Manager'],
  ['peakoutdoors.ca', 'Purchasing Manager'],
  ['blueboxpets.com', 'Category Buyer'],
  ['grocermax.ca', 'Procurement Manager'],
  ['palletpros.ca', 'Supply Manager'],
  ['warehouselabs.io', 'Ops Manager'],
  ['northcoastsupply.com', 'Purchasing Lead'],
  ['greenpack.ca', 'Procurement Specialist'],
];

export async function seedsProvider(_args: DiscoveryArgs): Promise<BuyerCandidate[]> {
  return SEED_HOSTS.map(([host, title]) => ({
    host: normalizeHost(host),
    platform: 'news',
    title,
    source: 'seeds',
    createdAt: nowISO(),
    proof: 'seed',
  }));
}