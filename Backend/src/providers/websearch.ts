import type { BuyerCandidate, DiscoveryArgs } from './types';

/**
 * Stubbed web search provider (no external calls in container).
 * Returns [] for now; seeds provide baseline candidates.
 */
export async function websearchProvider(_args: DiscoveryArgs): Promise<BuyerCandidate[]> {
  return [];
}