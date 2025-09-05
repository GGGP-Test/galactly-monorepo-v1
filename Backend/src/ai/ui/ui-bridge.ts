// src/ai/ui/ui-bridge.ts

import type { Channel } from "../feedback/feedback-store";
import type { ScoreWeights } from "../core/enrichment"; // assumes enrichment.ts exports ScoreWeights
// If your path differs, update the import above.

export type Strategy = "fast_close" | "lifetime_value" | "goodwill" | "balanced" | "custom";

export interface UIKnobs {
  speed?: number;        // 0..100 (how fast they want a close)
  stickiness?: number;   // 0..100 (how long they want the buyer to stay)
  goodwill?: number;     // 0..100 (how much they value reviews/referrals)
  channelFit?: number;   // 0..100 (optimize for reachable channels)
  priceFocus?: number;   // 0..100 (optimize for procurement/price change signals)
}

export interface UITuning {
  strategy?: Strategy;
  knobs?: UIKnobs;
  preferredChannels?: Channel[];
  excludeVendorsOverRevenue?: number; // USD
  targetCompanySize?: "micro" | "smb" | "mid";
}

export interface CompiledTuning {
  weights: ScoreWeights;
  preferredChannels: Channel[];
  notes: string[];
}

/** Very small event bus for real-time tuning updates. */
export class UIBridge {
  private listeners = new Set<(t: CompiledTuning) => void>();
  private last?: CompiledTuning;

  onUpdate(fn: (t: CompiledTuning) => void) {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    return () => this.listeners.delete(fn);
  }

  compile(input: UITuning): CompiledTuning {
    const strategy = input.strategy || "balanced";
    const k = normKnobs(input.knobs || {});
    // Base weights (sum ~ 100 but engine normalizes internally).
    let w: ScoreWeights = {
      demand: 16, productFit: 18, procurement: 14, ops: 12,
      reputation: 12, urgency: 14, seasonality: 6, channelFit: 8,
    };

    // Strategy presets
    if (strategy === "fast_close") w = { ...w, urgency: 22, demand: 18, productFit: 20, procurement: 10, ops: 8, channelFit: 12, reputation: 6, seasonality: 4 };
    if (strategy === "lifetime_value") w = { ...w, productFit: 24, ops: 18, reputation: 16, demand: 12, procurement: 10, urgency: 8, seasonality: 6, channelFit: 6 };
    if (strategy === "goodwill") w = { ...w, reputation: 24, productFit: 20, ops: 14, demand: 12, urgency: 10, procurement: 8, channelFit: 8, seasonality: 4 };

    // Knob deltas
    w.urgency += 12 * k.speed;
    w.seasonality += 6 * k.speed;

    w.productFit += 12 * k.stickiness;
    w.ops += 10 * k.stickiness;

    w.reputation += 16 * k.goodwill;

    w.channelFit += 14 * k.channelFit;

    w.procurement += 14 * k.priceFocus;

    // Normalize positive weights
    const sum = Object.values(w).reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const weights = Object.fromEntries(
      Object.entries(w).map(([k, v]) => [k, (100 * Math.max(0, v)) / sum])
    ) as ScoreWeights;

    const compiled: CompiledTuning = {
      weights,
      preferredChannels: input.preferredChannels || [],
      notes: buildNotes(strategy, input),
    };
    this.last = compiled;
    this.listeners.forEach((fn) => fn(compiled));
    return compiled;
  }
}

function normKnobs(knobs: UIKnobs) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x)) / 100;
  return {
    speed: clamp(knobs.speed ?? 0),
    stickiness: clamp(knobs.stickiness ?? 0),
    goodwill: clamp(knobs.goodwill ?? 0),
    channelFit: clamp(knobs.channelFit ?? 0),
    priceFocus: clamp(knobs.priceFocus ?? 0),
  };
}

function buildNotes(strategy: Strategy, input: UITuning): string[] {
  const n: string[] = [];
  n.push(`strategy:${strategy}`);
  if (input.excludeVendorsOverRevenue) n.push(`cap_vendor_revenue<=${input.excludeVendorsOverRevenue}`);
  if (input.targetCompanySize) n.push(`target_size:${input.targetCompanySize}`);
  if (input.preferredChannels?.length) n.push(`preferred_channels:${input.preferredChannels.join(",")}`);
  return n;
}
