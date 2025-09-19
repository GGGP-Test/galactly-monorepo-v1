import type { DiscoveryArgs, DiscoveryResult, BuyerCandidate } from './types';
import { uniqueByHostAndTitle } from './shared';
import { seedsProvider } from './seeds';
import { websearchProvider } from './websearch';
import { scoreOne, labelTemp, defaultScoreConfig } from './scoreRarer';

/**
 * Orchestrates all providers, de-dupes, scores, and labels hot/warm.
 * Safe to call from /api/v1/leads/find-buyers.
 */
export async function findBuyers(args: DiscoveryArgs): Promise<DiscoveryResult> {
  const batches: BuyerCandidate[][] = await Promise.all([
    seedsProvider(args),
    websearchProvider(args),
  ]);

  let cands = uniqueByHostAndTitle(batches.flat());

  for (const c of cands) {
    c.score = scoreOne(c, args);
    c.temp = labelTemp(c.score, defaultScoreConfig);
  }

  const hot = cands.filter(c => c.temp === 'hot').length;
  const warm = cands.filter(c => c.temp === 'warm').length;

  return { created: cands.length, hot, warm, candidates: cands };
}

export default { findBuyers };