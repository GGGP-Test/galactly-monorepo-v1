import type { BuyerCandidate, DiscoveryArgs } from './types';

export interface ScoreConfig {
  hotMin: number;  // score >= hotMin => hot
  warmMin: number; // else if >= warmMin => warm
}

export const defaultScoreConfig: ScoreConfig = { hotMin: 78, warmMin: 55 };

export function scoreOne(c: BuyerCandidate, args: DiscoveryArgs): number {
  let s = 40;

  const t = c.title.toLowerCase();

  // Role intent
  if (/purchasing|procurement|buyer|sourcing|category|supply chain/.test(t)) s += 18;
  if (/manager|lead|head|director|vp/.test(t)) s += 8;

  // Platform hints
  if (c.platform === 'news') s += 6;
  if (c.platform === 'directory' || c.platform === 'review') s += 4;

  // Persona title match (exact substring)
  if (args.persona?.titles) {
    const want = args.persona.titles.toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    if (want.some(w => t.includes(w))) s += 10;
  }

  // Proof richness (light heuristic)
  if (c.proof && c.proof.length > 0) s += Math.min(10, Math.round(c.proof.length / 40));

  s = Math.max(0, Math.min(100, s));
  return s;
}

export function labelTemp(score: number, cfg: ScoreConfig = defaultScoreConfig): 'hot' | 'warm' {
  return score >= cfg.hotMin ? 'hot' : 'warm';
}