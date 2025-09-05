// src/ai/feedback/feedback-store.ts

export type Channel =
  | "email"
  | "linkedin"
  | "instagram"
  | "x"
  | "tiktok"
  | "website_form"
  | "phone"
  | string;

export interface ChannelStat {
  channel: Channel;
  segment: string; // e.g., "US:NJ:stretch_wrap:SMB"
  trials: number;
  successes: number;
  alpha: number; // beta prior α
  beta: number;  // beta prior β
  lastAt?: number;
}

export interface FeedbackStore {
  /** Increment stats for a channel in a segment. success=true counts as win. */
  record(segment: string, channel: Channel, success: boolean): void;
  /** Get stats for channels in a given segment. Missing channels are initialized lazily. */
  get(segment: string, channels: Channel[]): ChannelStat[];
  /** Export all stats (for persistence/telemetry). */
  dump(): ChannelStat[];
  /** Replace all stats (load from persistence). */
  load(stats: ChannelStat[]): void;
}

export class InMemoryFeedbackStore implements FeedbackStore {
  private map = new Map<string, Map<string, ChannelStat>>();
  constructor(private defaults = { alpha: 1, beta: 1 }) {}

  record(segment: string, channel: Channel, success: boolean) {
    const s = this.ensure(segment, channel);
    s.trials += 1;
    s.successes += success ? 1 : 0;
    s.lastAt = Date.now();
  }

  get(segment: string, channels: Channel[]): ChannelStat[] {
    return channels.map((c) => this.ensure(segment, c));
  }

  dump(): ChannelStat[] {
    const out: ChannelStat[] = [];
    for (const [segment, cmap] of this.map) {
      for (const s of cmap.values()) out.push({ ...s, segment });
    }
    return out;
  }

  load(stats: ChannelStat[]) {
    this.map.clear();
    for (const s of stats) {
      const cmap = this.map.get(s.segment) || new Map<string, ChannelStat>();
      cmap.set(s.channel, { ...s });
      this.map.set(s.segment, cmap);
    }
  }

  private ensure(segment: string, channel: Channel): ChannelStat {
    let cmap = this.map.get(segment);
    if (!cmap) { cmap = new Map(); this.map.set(segment, cmap); }
    let stat = cmap.get(channel);
    if (!stat) {
      stat = {
        channel,
        segment,
        trials: 0,
        successes: 0,
        alpha: this.defaults.alpha,
        beta: this.defaults.beta,
      };
      cmap.set(channel, stat);
    }
    return stat;
  }
}

/** Helper: posterior mean for Beta(α+successes, β+(trials-successes)) */
export function posteriorMean(s: ChannelStat) {
  const a = s.alpha + s.successes;
  const b = s.beta + (s.trials - s.successes);
  return a / (a + b);
}

/** Helper: UCB1 bound with small-sample bonus. */
export function ucb1(s: ChannelStat, totalTrialsInSegment: number, c = 1.4) {
  const n = Math.max(1, s.trials);
  const p = posteriorMean(s);
  const bonus = c * Math.sqrt((2 * Math.log(Math.max(2, totalTrialsInSegment))) / n);
  return p + bonus;
}
