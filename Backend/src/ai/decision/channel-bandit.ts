// src/ai/decision/channel-bandit.ts

import { Channel, FeedbackStore, InMemoryFeedbackStore, posteriorMean, ucb1 } from "../feedback/feedback-store";

export interface BanditChoiceInput {
  segment: string;
  channels: Channel[];
  /** Optional: exclude channels under cooldown (ms) based on lastAt. */
  cooldownMs?: number;
  /** Optional: minimum trials before considering a channel "confident". */
  minTrials?: number;
  /** Optional: exploration factor for UCB1 (default 1.4). */
  explorationC?: number;
  /** Optional hard blocks (e.g., user disabled). */
  blocked?: Channel[];
}

export interface BanditChoice {
  chosen: Channel;
  ranked: { channel: Channel; score: number; trials: number; successRate: number }[];
}

export class ChannelBandit {
  constructor(private store: FeedbackStore = new InMemoryFeedbackStore()) {}

  choose(input: BanditChoiceInput): BanditChoice {
    const {
      segment,
      channels,
      cooldownMs = 20 * 60 * 1000,
      minTrials = 2,
      explorationC = 1.4,
      blocked = [],
    } = input;

    const stats = this.store.get(segment, channels)
      .filter(s => !blocked.includes(s.channel))
      .filter(s => {
        if (!cooldownMs) return true;
        return !s.lastAt || Date.now() - s.lastAt > cooldownMs;
      });

    const totalTrials = Math.max(1, stats.reduce((acc, s) => acc + Math.max(0, s.trials), 0));

    // If some channels haven't been tried enough, prioritize them round-robin style.
    const underTried = stats.filter(s => s.trials < minTrials);
    if (underTried.length) {
      const pick = underTried.sort((a, b) => a.trials - b.trials || a.channel.localeCompare(b.channel))[0];
      const ranked = this.rank(stats, totalTrials, explorationC);
      return { chosen: pick.channel, ranked };
    }

    const ranked = this.rank(stats, totalTrials, explorationC);
    return { chosen: ranked[0].channel, ranked };
  }

  /** Report outcome so the bandit learns. */
  report(segment: string, channel: Channel, outcome: "success" | "fail") {
    this.store.record(segment, channel, outcome === "success");
  }

  /** Convenience: return posterior means for dashboarding. */
  currentRates(segment: string, channels: Channel[]) {
    const stats = this.store.get(segment, channels);
    return stats.map(s => ({
      channel: s.channel,
      trials: s.trials,
      successRate: s.trials ? s.successes / s.trials : 0,
      posteriorMean: posteriorMean(s),
    }));
  }

  private rank(stats: ReturnType<FeedbackStore["get"]>, totalTrials: number, c: number) {
    return stats
      .map(s => ({
        channel: s.channel,
        score: ucb1(s, totalTrials, c),
        trials: s.trials,
        successRate: s.trials ? s.successes / s.trials : 0,
      }))
      .sort((a, b) => b.score - a.score);
  }
}

/* Example segmenting helper:
   Build a stable segment key so the bandit learns per cohort (geo × product × size). */
export function buildSegmentKey(args: {
  country?: string; state?: string;
  productTag?: string; companySize?: "micro" | "smb" | "mid";
}) {
  const c = (args.country || "US").toUpperCase();
  const s = (args.state || "NA").toUpperCase();
  const p = (args.productTag || "general").toLowerCase();
  const z = (args.companySize || "smb").toLowerCase();
  return `${c}:${s}:${p}:${z}`;
}
