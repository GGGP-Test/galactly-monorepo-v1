// src/ai/learn/feedback-consumer.ts
// Subscribes to feedback-store and updates bandit + optional rule learning hooks.

import { ChannelBandit, attachToFeedback } from "../logic/channel-bandit";

// Lazy import to avoid hard coupling if file paths differ in your project.
function tryLoadFeedbackBus():
  | { bus: { on: (ev: string, cb: (e: any) => void) => void } }
  | null {
  try {
    // Adjust this path if your feedback-store lives elsewhere.
    // Expected to export: `feedbackBus` (Node-style EventEmitter) OR { on(...) }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("./feedback-store");
    const bus = mod.feedbackBus || mod.bus || mod.default || mod;
    if (bus?.on) return { bus };
    return null;
  } catch { return null; }
}

export interface FeedbackConsumerOptions {
  bandit?: ChannelBandit;
  // hook to update additional models (e.g., per-rule weights, prompt p50s, pricing)
  onFeedback?: (e: any) => Promise<void> | void;
}

export async function startFeedbackConsumer(opts: FeedbackConsumerOptions = {}) {
  const bandit = opts.bandit ?? new ChannelBandit();
  const holder = tryLoadFeedbackBus();
  if (!holder) return { started: false, reason: "feedback bus not found" as const };

  // route outreach outcomes into the bandit
  await attachToFeedback(bandit, holder.bus);

  // optional additional learning sinks
  if (opts.onFeedback) {
    holder.bus.on("feedback:outreach", (e: any) => {
      Promise.resolve(opts.onFeedback!(e)).catch(() => {});
    });
  }

  // also listen to lead lifecycle for non-outreach signals
  holder.bus.on("feedback:lead", (e: any) => {
    // e.g., { kind: "converted"|"lost", leadId, orgId, reason }
    // You can map "converted" to a synthetic success on the last channel used if needed.
  });

  return { started: true as const };
}
