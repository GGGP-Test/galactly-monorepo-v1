import type { BuyerCandidate, DiscoveryArgs } from './types';

/**
 * Stubbed web search provider: no external calls in the container.
 * Returns [] so we rely on seeds for deterministic output.
 * Later, we can wire Bing/Serp/Glider/etc. behind env flags.
 */
export async function websearchProvider(_args: DiscoveryArgs): Promise<BuyerCandidate[]> {
  return [];
}