// src/ai/logic/channel-bandit.ts
// Contextual multi-armed bandit for outreach channel selection (Thompson Sampling).
// Persists per-tenant/per-segment stats via adapter. Listens to feedback (optional).

import { Flags, FeatureContext } from "../core/feature-flags";

export type Channel = "email" | "linkedin" | "phone" | "sms" | "inmail";
export type Outcome = "success" | "reply" | "booked" | "fail" | "bounce";

export interface BanditContext extends FeatureContext {
  orgId: string;
  userId?: string;
  leadId?: string;
  industry?: string;
  sizeTier?: "s" | "m" | "l";
  timezone?: string;
  signals?: string[]; // e.g. ["rfq","ecom","ads"]
}

export interface ArmStats {
  alpha: number; // successes + prior
  beta: number;  // failures + prior
  trials: number;
  success: number;
  lastAt?: number;
}

export interface SegmentStats {
  key: string;
  arms: Record<Channel, ArmStats>;
}

export interface BanditStore {
  loadSegment(key: string): Promise<SegmentStats | null>;
  saveSegment(seg: SegmentStats): Promise<void>;
}

export class InMemoryBanditStore implements BanditStore {
  private m = new Map<string, SegmentStats>();
  async loadSegment(key: string) { return this.m.get(key) ?? null; }
  async saveSegment(seg: SegmentStats) { this.m.set(seg.key, seg); }
}

export interface SelectOptions {
  candidates?: Channel[];      // default all
  priors?: Partial<Record<Channel, { alpha: number; beta: number }>>;
  minCooldownMs?: number;      // avoid hammering same arm too fast per segment
  explorationBoost?: number;   // add to beta to encourage explore; default 0
}

export interface Selection {
  channel: Channel;
  debug: {
    draws: Record<Channel, number>;
    stats: Record<Channel, ArmStats>;
    segmentKey: string;
    explored: boolean;
  };
}

const DEFAULT_ARMS: Channel[] = ["email", "linkedin", "phone", "sms", "inmail"];

function bucket(v?: string, size = 16) {
  if (!v) return "0";
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
  return String(Math.abs(h) % size);
}

function segKey(ctx: BanditContext) {
  // tenant + coarse user/lead/industry/size/signals bucket; keeps generalizable and privacy-light
  const sig = (ctx.signals ?? []).slice(0, 3).sort().join(",");
  return [
    "org", ctx.orgId ?? "x",
    "ind", bucket(ctx.industry ?? "x", 64),
    "sz", ctx.sizeTier ?? "s",
    "tz", (ctx.timezone ?? "x").replace(/[^\w]/g, "").slice(0, 5),
    "sg", bucket(sig, 128),
  ].join(":");
}

function defaultStats(priors?: SelectOptions["priors"]): Record<Channel, ArmStats> {
  const out: Record<Channel, ArmStats> = Object.create(null);
  for (const c of DEFAULT_ARMS) {
    const p = priors?.[c] ?? { alpha: 1, beta: 1 }; // uninformative prior
    out[c] = { alpha: p.alpha, beta: p.beta, trials: 0, success: 0 };
  }
  return out;
}

function randBeta(a: number, b: number) {
  // Cheng’s algorithm for Beta via Gamma
  const x = gamma(a);
  const y = gamma(b);
  return x / (x + y);
}
function gamma(k: number) {
  // Marsaglia & Tsang
  const d = k < 1 ? k + (1 - k) : k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do { x = normal(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.331 * (x * x) * (x * x)) return d * v * (k < 1 ? Math.pow(Math.random(), 1 / k) : 1);
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * (k < 1 ? Math.pow(Math.random(), 1 / k) : 1);
  }
}
function normal() {
  // Box–Muller
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class ChannelBandit {
  constructor(private store: BanditStore = new InMemoryBanditStore()) {}

  async select(ctx: BanditContext, opts: SelectOptions = {}): Promise<Selection> {
    const enabled = Flags.routerV2({ plan: ctx.plan });
    const arms = (opts.candidates?.length ? opts.candidates : DEFAULT_ARMS) as Channel[];
    const key = segKey(ctx);
    const seg = (await this.store.loadSegment(key)) ?? { key, arms: defaultStats(opts.priors) };

    const now = Date.now();
    const draws: Record<Channel, number> = Object.create(null);
    let best: Channel | null = null;
    let bestVal = -1;
    let explored = false;

    for (const c of arms) {
      const s = seg.arms[c] ?? (seg.arms[c] = { alpha: 1, beta: 1, trials: 0, success: 0 });
      let a = s.alpha, b = s.beta;
      if (opts.explorationBoost) b += opts.explorationBoost;
      const val = enabled ? randBeta(a, b) : a / (a + b); // V2: Thompson; fallback: mean
      draws[c] = val;
      const cooldownOk = !opts.minCooldownMs || !s.lastAt || now - s.lastAt >= opts.minCooldownMs;
      const score = cooldownOk ? val : val * 0.7; // slight penalty under cooldown
      if (score > bestVal) { bestVal = score; best = c; explored = explored || cooldownOk === false; }
    }

    if (!best) best = arms[0];
    return { channel: best, debug: { draws, stats: seg.arms, segmentKey: key, explored } };
  }

  async record(ctx: BanditContext, channel: Channel, outcome: Outcome) {
    const key = segKey(ctx);
    const seg = (await this.store.loadSegment(key)) ?? { key, arms: defaultStats() };
    const arm = seg.arms[channel] ?? (seg.arms[channel] = { alpha: 1, beta: 1, trials: 0, success: 0 });
    arm.trials += 1;
    arm.lastAt = Date.now();

    const positive = outcome === "success" || outcome === "booked" || outcome === "reply";
    const negative = outcome === "fail" || outcome === "bounce";

    if (positive) { arm.alpha += 1; arm.success += 1; }
    if (negative) { arm.beta += 1; }

    await this.store.saveSegment(seg);
  }
}

// Optional: wire feedback bus if available at runtime (avoids hard dep).
// Expect events: { orgId, userId, leadId, channel, outcome }
type AnyBus = { on: (ev: string, cb: (e: any) => void) => void };
export async function attachToFeedback(bandit: ChannelBandit, bus: AnyBus) {
  bus.on("feedback:outreach", (e: any) => {
    const ctx: BanditContext = { orgId: e.orgId, userId: e.userId, leadId: e.leadId, plan: e.plan, signals: e.signals };
    bandit.record(ctx, e.channel as Channel, e.outcome as Outcome).catch(() => {});
  });
}
